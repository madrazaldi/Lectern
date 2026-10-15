use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, async_runtime::spawn_blocking};
use tauri_plugin_http::reqwest::{self, StatusCode, header};
use tokio::{
    fs::{File, OpenOptions},
    io::AsyncWriteExt,
    sync::watch,
};
use tokio_util::sync::CancellationToken;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);
/// Folders without a meta.json younger than this may be a download that is just starting.
const ORPHAN_AGE: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    received: u64,
    total: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Cancelled,
    /// Worth retrying; whatever reached the disk is kept for resuming.
    Network,
    Http,
    /// The server sent something other than the file we asked for.
    Invalid,
    Io,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadError {
    kind: ErrorKind,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

impl DownloadError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status: None,
        }
    }
    fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "cancelled")
    }
    fn io(e: io::Error) -> Self {
        if e.kind() == io::ErrorKind::StorageFull {
            return Self::new(ErrorKind::Io, "The disk is full");
        }
        Self::new(ErrorKind::Io, e.to_string())
    }
    fn http(status: StatusCode) -> Self {
        let message = match status.as_u16() {
            401 => "The server no longer accepts this sign-in".to_string(),
            403 => "This account isn't allowed to download this title".to_string(),
            404 => "The file is no longer on the server".to_string(),
            _ => format!("The server answered HTTP {}", status.as_u16()),
        };
        Self {
            kind: ErrorKind::Http,
            message,
            status: Some(status.as_u16()),
        }
    }
}

fn network(e: reqwest::Error) -> DownloadError {
    let message = if e.is_timeout() {
        "The connection timed out".to_string()
    } else if e.is_connect() {
        "Couldn't reach the server".to_string()
    } else {
        format!("The connection dropped ({e})")
    };
    DownloadError::new(ErrorKind::Network, message)
}

fn downloads_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("downloads"))
}

/// Accepts only a single plain path segment so callers cannot escape `downloads/`.
fn segment<'a>(name: &'a str, what: &str) -> Result<&'a str, String> {
    let bad = name.is_empty()
        || name.starts_with('.')
        || name.contains("..")
        || name.contains(['/', '\\', '\0']);
    if bad {
        Err(format!("invalid {what}"))
    } else {
        Ok(name)
    }
}

// ---------------------------------------------------------------------------
// In-flight attempts. Every call to `download_file` is one attempt with an id that the frontend
// never reuses, so a cancel can't leak into a later attempt, and a cancel that arrives before its
// attempt has started still stops it.

struct Attempt {
    serial: u64,
    part: PathBuf,
    token: CancellationToken,
    /// Closes when the attempt has finished with the file.
    done: watch::Receiver<()>,
}

#[derive(Default)]
struct Registry {
    next: u64,
    attempts: HashMap<String, Attempt>,
    cancelled_early: HashSet<String>,
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Mutex::default);
/// Serializes meta writes against folder removal, so a late write can't land in a deleted folder.
static DIR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn registry() -> std::sync::MutexGuard<'static, Registry> {
    REGISTRY.lock().unwrap_or_else(|e| e.into_inner())
}

struct AttemptGuard {
    id: String,
    serial: u64,
    _done: watch::Sender<()>,
}

impl Drop for AttemptGuard {
    fn drop(&mut self) {
        let mut reg = registry();
        if reg
            .attempts
            .get(&self.id)
            .is_some_and(|a| a.serial == self.serial)
        {
            reg.attempts.remove(&self.id);
        }
        // `_done` drops after this, waking everyone waiting for the attempt to end.
    }
}

async fn wait_all(waits: Vec<watch::Receiver<()>>) {
    for mut rx in waits {
        // Resolves with an error once the sender is gone, which is the only signal we use.
        let _ = rx.changed().await;
    }
}

/// Registers an attempt, first stopping (and waiting out) any other attempt writing the same file,
/// e.g. one left running by a reloaded webview.
async fn register(
    id: &str,
    part: &Path,
) -> Result<(AttemptGuard, CancellationToken), DownloadError> {
    loop {
        let clashes = {
            let mut reg = registry();
            if reg.cancelled_early.remove(id) {
                return Err(DownloadError::cancelled());
            }
            let clashes: Vec<_> = reg
                .attempts
                .iter()
                .filter(|(other, a)| other.as_str() == id || a.part == part)
                .map(|(_, a)| {
                    a.token.cancel();
                    a.done.clone()
                })
                .collect();
            if clashes.is_empty() {
                reg.next += 1;
                let serial = reg.next;
                let token = CancellationToken::new();
                let (tx, rx) = watch::channel(());
                reg.attempts.insert(
                    id.to_string(),
                    Attempt {
                        serial,
                        part: part.to_path_buf(),
                        token: token.clone(),
                        done: rx,
                    },
                );
                let guard = AttemptGuard {
                    id: id.to_string(),
                    serial,
                    _done: tx,
                };
                return Ok((guard, token));
            }
            clashes
        };
        wait_all(clashes).await;
    }
}

/// Cancels the matching attempts and returns once they have let go of their files.
async fn cancel_where(pred: impl Fn(&str, &Attempt) -> bool) {
    let waits: Vec<_> = registry()
        .attempts
        .iter()
        .filter(|(id, a)| pred(id, a))
        .map(|(_, a)| {
            a.token.cancel();
            a.done.clone()
        })
        .collect();
    wait_all(waits).await;
}

// ---------------------------------------------------------------------------
// Pure decisions, kept apart from I/O so they can be tested.

/// Where to resume from given the bytes already in the .part file (0 means start over).
fn resume_offset(existing: u64, expected: Option<u64>) -> u64 {
    match expected {
        Some(e) if existing > e => 0,
        _ => existing,
    }
}

/// `bytes 100-199/1000` → (Some(100), Some(1000)); `bytes */1000` → (None, Some(1000)).
fn parse_content_range(value: &str) -> Option<(Option<u64>, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes")?.trim_start();
    let (range, total) = rest.split_once('/')?;
    let total = match total.trim() {
        "*" => None,
        t => Some(t.parse().ok()?),
    };
    let start = match range.trim() {
        "*" => None,
        r => Some(r.split_once('-')?.0.trim().parse().ok()?),
    };
    Some((start, total))
}

#[derive(Debug, PartialEq)]
enum Start {
    /// Write from `offset` (0 truncates); `total` is the size of the whole file if known.
    At { offset: u64, total: Option<u64> },
    /// The .part already holds the whole file.
    Complete,
    /// The server can't continue from where we are; the .part has to go.
    Restart,
}

fn interpret_response(
    status: u16,
    offset: u64,
    content_range: Option<&str>,
    content_length: Option<u64>,
) -> Result<Start, DownloadError> {
    let range = content_range.and_then(parse_content_range);
    match status {
        200 => Ok(Start::At {
            offset: 0,
            total: content_length,
        }),
        206 => match range {
            Some((Some(start), total)) if start == offset => Ok(Start::At {
                offset,
                total: total.or(content_length.map(|n| n + offset)),
            }),
            _ => Ok(Start::Restart),
        },
        416 => match range {
            Some((None, Some(total))) if total == offset && offset > 0 => Ok(Start::Complete),
            _ => Ok(Start::Restart),
        },
        s => Err(DownloadError::http(
            StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
        )),
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Audio,
    Image,
}

/// Rejects responses that are plainly not the media we asked for, e.g. a proxy's HTML sign-in page.
fn content_type_ok(kind: Kind, content_type: Option<&str>) -> bool {
    let Some(ct) = content_type else {
        return true;
    };
    let mime = ct
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match kind {
        Kind::Image => mime.starts_with("image/"),
        Kind::Audio => {
            !(mime.starts_with("text/")
                || mime == "application/json"
                || mime.ends_with("+json")
                || mime.ends_with("/xml")
                || mime.ends_with("+xml"))
        }
    }
}

/// Checks a finished file against what the server announced and what the library metadata says.
fn verify_size(len: u64, total: Option<u64>, expected: Option<u64>) -> Result<(), DownloadError> {
    if let Some(t) = total {
        if len < t {
            return Err(DownloadError::new(
                ErrorKind::Network,
                "The connection ended before the file was complete",
            ));
        }
        if len > t {
            return Err(DownloadError::new(
                ErrorKind::Invalid,
                format!("Received {len} bytes but the server announced {t}"),
            ));
        }
    }
    match expected {
        Some(e) if e != len => Err(DownloadError::new(
            ErrorKind::Invalid,
            format!("Received {len} bytes but the library lists {e}"),
        )),
        _ => Ok(()),
    }
}

/// Writes `name` in `dir` via a temp file and rename, so readers never see half a file.
/// With `create` false a missing folder is left missing: the download was deleted.
fn write_atomic(dir: &Path, name: &str, contents: &[u8], create: bool) -> io::Result<bool> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    if create {
        fs::create_dir_all(dir)?;
    } else if !dir.is_dir() {
        return Ok(false);
    }
    let tmp = dir.join(format!(
        "{name}.{}.tmp",
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let result = fs::write(&tmp, contents).and_then(|()| fs::rename(&tmp, dir.join(name)));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map(|()| true)
}

// ---------------------------------------------------------------------------

struct Request<'a> {
    url: &'a str,
    headers: &'a HashMap<String, String>,
    part: &'a Path,
    expected: Option<u64>,
    kind: Kind,
}

fn validator_path(part: &Path) -> PathBuf {
    let mut s = part.as_os_str().to_owned();
    s.push(".validator");
    PathBuf::from(s)
}

async fn discard_part(part: &Path) {
    let _ = tokio::fs::remove_file(part).await;
    let _ = tokio::fs::remove_file(validator_path(part)).await;
}

/// Streams the file into its .part, resuming from what is already there when the server allows.
async fn fetch(
    req: &Request<'_>,
    token: &CancellationToken,
    progress: impl Fn(u64, Option<u64>),
) -> Result<(), DownloadError> {
    let existing = tokio::fs::metadata(req.part)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let offset = resume_offset(existing, req.expected);
    let validator = if offset > 0 {
        tokio::fs::read_to_string(validator_path(req.part))
            .await
            .ok()
    } else {
        None
    };

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(network)?;
    let mut request = client.get(req.url);
    for (name, value) in req.headers {
        request = request.header(name.as_str(), value.as_str());
    }
    if offset > 0 {
        request = request.header(header::RANGE, format!("bytes={offset}-"));
        // Only continue if the file is still the one we started on; otherwise the server sends it all.
        if let Some(v) = &validator {
            request = request.header(header::IF_RANGE, v.trim());
        }
    }
    let mut response = tokio::select! {
        _ = token.cancelled() => return Err(DownloadError::cancelled()),
        r = request.send() => r.map_err(network)?,
    };

    let headers = response.headers();
    let text = |name| headers.get(name).and_then(|v| v.to_str().ok());
    let start = interpret_response(
        response.status().as_u16(),
        offset,
        text(header::CONTENT_RANGE),
        response.content_length(),
    )?;
    let (offset, total) = match start {
        Start::Complete => return verify_part(req.part, Some(existing), req.expected).await,
        Start::Restart => {
            discard_part(req.part).await;
            return Err(DownloadError::new(
                ErrorKind::Network,
                "The server couldn't resume this file",
            ));
        }
        Start::At { offset, total } => (offset, total),
    };
    if !content_type_ok(req.kind, text(header::CONTENT_TYPE)) {
        return Err(DownloadError::new(
            ErrorKind::Invalid,
            format!(
                "The server sent {} instead of the file",
                text(header::CONTENT_TYPE).unwrap_or("something else")
            ),
        ));
    }
    if let (Some(t), Some(e)) = (total, req.expected)
        && t != e
    {
        return Err(DownloadError::new(
            ErrorKind::Invalid,
            format!("The server offered {t} bytes but the library lists {e}"),
        ));
    }
    let validator = text(header::ETAG)
        .or(text(header::LAST_MODIFIED))
        .map(str::to_owned);

    let mut file = if offset > 0 {
        OpenOptions::new()
            .append(true)
            .open(req.part)
            .await
            .map_err(DownloadError::io)?
    } else {
        let file = File::create(req.part).await.map_err(DownloadError::io)?;
        match validator {
            Some(v) => tokio::fs::write(validator_path(req.part), v).await,
            None => tokio::fs::remove_file(validator_path(req.part))
                .await
                .or(Ok(())),
        }
        .map_err(DownloadError::io)?;
        file
    };

    let mut received = offset;
    let mut last_emit = Instant::now();
    let emit = |received| progress(received, total);
    emit(received);
    let streamed = async {
        loop {
            let chunk = tokio::select! {
                _ = token.cancelled() => return Err(DownloadError::cancelled()),
                c = response.chunk() => c.map_err(network)?,
            };
            let Some(chunk) = chunk else {
                return Ok(());
            };
            file.write_all(&chunk).await.map_err(DownloadError::io)?;
            received += chunk.len() as u64;
            if last_emit.elapsed() >= PROGRESS_INTERVAL {
                last_emit = Instant::now();
                emit(received);
            }
        }
    }
    .await;
    // Whatever happened, what reached the disk stays for the next attempt to resume from. Flushing
    // also makes sure the file is really closed on return, which Windows needs before it can be deleted.
    let flushed = file.flush().await.map_err(DownloadError::io);
    streamed?;
    flushed?;
    file.sync_all().await.map_err(DownloadError::io)?;
    drop(file);
    emit(received);
    verify_part(req.part, total, req.expected).await
}

/// Checks the finished .part; one that came out the wrong size can't be resumed, so it goes.
async fn verify_part(
    part: &Path,
    total: Option<u64>,
    expected: Option<u64>,
) -> Result<(), DownloadError> {
    let len = tokio::fs::metadata(part)
        .await
        .map_err(DownloadError::io)?
        .len();
    let result = verify_size(len, total, expected);
    if result.as_ref().is_err_and(|e| e.kind == ErrorKind::Invalid) {
        discard_part(part).await;
    }
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn download_file(
    app: AppHandle,
    id: String,
    url: String,
    headers: HashMap<String, String>,
    dir: String,
    file_name: String,
    expected_size: Option<u64>,
    kind: Option<String>,
) -> Result<String, DownloadError> {
    let bad = |e: String| DownloadError::new(ErrorKind::Io, e);
    let dir_path = downloads_root(&app)
        .map_err(bad)?
        .join(segment(&dir, "dir").map_err(bad)?);
    let file_name = segment(&file_name, "file name").map_err(bad)?;
    let target = dir_path.join(file_name);
    let part = dir_path.join(format!("{file_name}.part"));
    let kind = match kind.as_deref() {
        Some("image") => Kind::Image,
        _ => Kind::Audio,
    };

    let (_guard, token) = register(&id, &part).await?;
    // The folder is created with the download's meta; if it's gone, the download was deleted.
    if !dir_path.is_dir() {
        return Err(DownloadError::cancelled());
    }
    let request = Request {
        url: &url,
        headers: &headers,
        part: &part,
        expected: expected_size.filter(|&n| n > 0),
        kind,
    };
    let progress = |received, total| {
        let _ = app.emit(
            "download-progress",
            Progress {
                id: &id,
                received,
                total,
            },
        );
    };
    fetch(&request, &token, progress).await?;
    tokio::fs::rename(&part, &target)
        .await
        .map_err(DownloadError::io)?;
    let _ = tokio::fs::remove_file(validator_path(&part)).await;
    Ok(target.to_string_lossy().into_owned())
}

/// Stops an attempt and returns once it has closed its file.
#[tauri::command]
pub async fn cancel_download(id: String) {
    let waits = {
        let mut reg = registry();
        match reg.attempts.get(&id) {
            Some(a) => {
                a.token.cancel();
                Some(a.done.clone())
            }
            None => {
                // Not started yet (or already over): make sure it never starts.
                reg.cancelled_early.insert(id);
                None
            }
        }
    };
    if let Some(rx) = waits {
        wait_all(vec![rx]).await;
    }
}

#[tauri::command]
pub async fn write_download_meta(
    app: AppHandle,
    dir: String,
    json: String,
    create: Option<bool>,
) -> Result<bool, String> {
    let dir_path = downloads_root(&app)?.join(segment(&dir, "dir")?);
    let _lock = DIR_LOCK.lock().await;
    spawn_blocking(move || {
        write_atomic(
            &dir_path,
            "meta.json",
            json.as_bytes(),
            create == Some(true),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_download_meta(app: AppHandle) -> Result<Vec<String>, String> {
    let root = downloads_root(&app)?;
    spawn_blocking(move || {
        let Ok(entries) = fs::read_dir(root) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|entry| fs::read_to_string(entry.path().join("meta.json")).ok())
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_download(app: AppHandle, dir: String) -> Result<(), String> {
    let dir_path = downloads_root(&app)?.join(segment(&dir, "dir")?);
    // Open files can't be deleted on Windows: let every attempt in this folder finish first.
    cancel_where(|_, a| a.part.parent() == Some(dir_path.as_path())).await;
    let _lock = DIR_LOCK.lock().await;
    match tokio::fs::remove_dir_all(dir_path).await {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Deletes folders that have no meta.json (a download that never got going) and stray temp files.
fn prune(root: &Path, now: SystemTime) -> u32 {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let busy: Vec<PathBuf> = registry()
        .attempts
        .values()
        .filter_map(|a| a.part.parent().map(Path::to_path_buf))
        .collect();
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || busy.contains(&path) {
            continue;
        }
        if path.join("meta.json").is_file() {
            for f in fs::read_dir(&path).into_iter().flatten().flatten() {
                let name = f.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("meta.json.") && name.ends_with(".tmp") {
                    let _ = fs::remove_file(f.path());
                }
            }
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .is_ok_and(|t| now.duration_since(t).is_ok_and(|age| age >= ORPHAN_AGE));
        if old && fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[tauri::command]
pub async fn prune_downloads(app: AppHandle) -> Result<u32, String> {
    let root = downloads_root(&app)?;
    let _lock = DIR_LOCK.lock().await;
    spawn_blocking(move || prune(&root, SystemTime::now()))
        .await
        .map_err(|e| e.to_string())
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => dir_size(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

#[tauri::command]
pub async fn downloads_usage(app: AppHandle) -> Result<u64, String> {
    let root = downloads_root(&app)?;
    spawn_blocking(move || dir_size(&root))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(unix)]
fn available_space(path: &Path) -> io::Result<u64> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let c = CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other)?;
    // SAFETY: `c` is a valid NUL-terminated path and `stat` is a plain C struct we own.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut stat) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // The field types differ between platforms; `from` keeps every one of them lossless.
    #[allow(clippy::useless_conversion)]
    Ok(u64::from(stat.f_bavail).saturating_mul(u64::from(stat.f_frsize)))
}

#[cfg(windows)]
fn available_space(path: &Path) -> io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free = 0u64;
    // SAFETY: `wide` is NUL-terminated and outlives the call; the other outputs are optional.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(free)
    }
}

#[cfg(not(any(unix, windows)))]
fn available_space(_path: &Path) -> io::Result<u64> {
    Ok(u64::MAX)
}

/// Free bytes on the disk that holds the downloads folder.
#[tauri::command]
pub async fn downloads_free_space(app: AppHandle) -> Result<u64, String> {
    let root = downloads_root(&app)?;
    spawn_blocking(move || {
        // The folder may not exist yet: ask about the nearest ancestor that does.
        let existing = root.ancestors().find(|p| p.exists()).unwrap_or(&root);
        available_space(existing).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lectern-dl-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn resumes_from_what_is_on_disk() {
        assert_eq!(resume_offset(0, Some(100)), 0);
        assert_eq!(resume_offset(40, Some(100)), 40);
        assert_eq!(resume_offset(40, None), 40);
        assert_eq!(resume_offset(100, Some(100)), 100);
        // Bigger than the file should be: it can't be the right file.
        assert_eq!(resume_offset(140, Some(100)), 0);
    }

    #[test]
    fn parses_content_range() {
        assert_eq!(
            parse_content_range("bytes 100-960444/960445"),
            Some((Some(100), Some(960445)))
        );
        assert_eq!(
            parse_content_range("bytes */960445"),
            Some((None, Some(960445)))
        );
        assert_eq!(parse_content_range("bytes 0-9/*"), Some((Some(0), None)));
        assert_eq!(parse_content_range("items 0-9/10"), None);
        assert_eq!(parse_content_range("bytes x-9/10"), None);
    }

    #[test]
    fn appends_when_the_server_honours_the_range() {
        assert_eq!(
            interpret_response(206, 100, Some("bytes 100-960444/960445"), Some(960345)),
            Ok(Start::At {
                offset: 100,
                total: Some(960445)
            })
        );
        // No total in Content-Range: work it out from the length.
        assert_eq!(
            interpret_response(206, 100, Some("bytes 100-199/*"), Some(100)),
            Ok(Start::At {
                offset: 100,
                total: Some(200)
            })
        );
    }

    #[test]
    fn starts_over_when_the_server_ignores_the_range() {
        assert_eq!(
            interpret_response(200, 100, None, Some(960445)),
            Ok(Start::At {
                offset: 0,
                total: Some(960445)
            })
        );
        assert_eq!(
            interpret_response(206, 100, Some("bytes 0-99/1000"), Some(100)),
            Ok(Start::Restart)
        );
        assert_eq!(
            interpret_response(206, 100, None, Some(100)),
            Ok(Start::Restart)
        );
    }

    #[test]
    fn a_complete_part_needs_no_more_bytes() {
        assert_eq!(
            interpret_response(416, 960445, Some("bytes */960445"), Some(148)),
            Ok(Start::Complete)
        );
        assert_eq!(
            interpret_response(416, 500, Some("bytes */960445"), Some(148)),
            Ok(Start::Restart)
        );
    }

    #[test]
    fn reports_http_errors() {
        let err = interpret_response(401, 0, None, Some(12)).unwrap_err();
        assert_eq!(err.kind, ErrorKind::Http);
        assert_eq!(err.status, Some(401));
    }

    #[test]
    fn rejects_pages_that_are_not_media() {
        assert!(content_type_ok(Kind::Audio, Some("audio/mpeg")));
        assert!(content_type_ok(Kind::Audio, Some("audio/mp4")));
        assert!(content_type_ok(Kind::Audio, Some("video/mp4")));
        assert!(content_type_ok(
            Kind::Audio,
            Some("application/octet-stream")
        ));
        assert!(content_type_ok(Kind::Audio, None));
        assert!(!content_type_ok(
            Kind::Audio,
            Some("text/html; charset=utf-8")
        ));
        assert!(!content_type_ok(Kind::Audio, Some("application/json")));
        assert!(!content_type_ok(Kind::Audio, Some("application/xhtml+xml")));
        assert!(content_type_ok(Kind::Image, Some("image/jpeg")));
        assert!(!content_type_ok(
            Kind::Image,
            Some("text/plain; charset=utf-8")
        ));
    }

    #[test]
    fn verifies_the_finished_size() {
        assert!(verify_size(100, Some(100), Some(100)).is_ok());
        assert!(verify_size(100, None, None).is_ok());
        assert_eq!(
            verify_size(60, Some(100), Some(100)).unwrap_err().kind,
            ErrorKind::Network
        );
        assert_eq!(
            verify_size(120, Some(100), None).unwrap_err().kind,
            ErrorKind::Invalid
        );
        assert_eq!(
            verify_size(100, Some(100), Some(90)).unwrap_err().kind,
            ErrorKind::Invalid
        );
    }

    #[test]
    fn writes_meta_atomically_and_never_recreates_a_deleted_folder() {
        let dir = temp_dir("meta");
        assert!(!write_atomic(&dir, "meta.json", b"{}", false).unwrap());
        assert!(!dir.exists());

        assert!(write_atomic(&dir, "meta.json", b"{\"a\":1}", true).unwrap());
        assert!(write_atomic(&dir, "meta.json", b"{\"a\":2}", false).unwrap());
        assert_eq!(
            fs::read_to_string(dir.join("meta.json")).unwrap(),
            "{\"a\":2}"
        );
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .filter(|n| n != "meta.json")
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prunes_only_old_folders_without_meta() {
        let root = temp_dir("prune");
        fs::create_dir_all(root.join("kept")).unwrap();
        fs::write(root.join("kept/meta.json"), "{}").unwrap();
        fs::write(root.join("kept/meta.json.3.tmp"), "{").unwrap();
        fs::write(root.join("kept/001.mp3.part"), "abc").unwrap();
        fs::create_dir_all(root.join("orphan")).unwrap();
        fs::write(root.join("orphan/001.mp3.part"), "abc").unwrap();

        // Young orphans may be a download that is just starting.
        assert_eq!(prune(&root, SystemTime::now()), 0);
        assert_eq!(prune(&root, SystemTime::now() + ORPHAN_AGE * 2), 1);
        assert!(!root.join("orphan").exists());
        assert!(root.join("kept/001.mp3.part").exists());
        assert!(!root.join("kept/meta.json.3.tmp").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn reports_free_space() {
        assert!(available_space(&std::env::temp_dir()).unwrap() > 0);
    }

    #[tokio::test]
    async fn cancelling_before_start_stops_only_that_attempt() {
        let part = std::env::temp_dir().join("lectern-dl-test-early.part");
        cancel_download("early@1".into()).await;
        assert_eq!(
            register("early@1", &part).await.err(),
            Some(DownloadError::cancelled())
        );
        // A later attempt for the same file is unaffected.
        let (guard, token) = register("early@2", &part).await.unwrap();
        assert!(!token.is_cancelled());
        drop(guard);
    }

    #[tokio::test]
    async fn a_new_attempt_on_the_same_file_waits_for_the_old_one() {
        let part = std::env::temp_dir().join("lectern-dl-test-clash.part");
        let (old_guard, old_token) = register("clash@1", &part).await.unwrap();
        let old = tokio::spawn(async move {
            old_token.cancelled().await;
            tokio::time::sleep(Duration::from_millis(20)).await;
            drop(old_guard);
            Instant::now()
        });
        let (_guard, token) = register("clash@2", &part).await.unwrap();
        let started = Instant::now();
        assert!(old.await.unwrap() <= started);
        assert!(!token.is_cancelled());
    }

    #[tokio::test]
    async fn cancel_waits_for_the_attempt_to_finish() {
        let part = std::env::temp_dir().join("lectern-dl-test-wait.part");
        let (guard, token) = register("wait@1", &part).await.unwrap();
        let worker = tokio::spawn(async move {
            token.cancelled().await;
            tokio::time::sleep(Duration::from_millis(20)).await;
            drop(guard);
            Instant::now()
        });
        cancel_download("wait@1".into()).await;
        let returned = Instant::now();
        assert!(worker.await.unwrap() <= returned);
    }

    fn audio_request<'a>(
        url: &'a str,
        headers: &'a HashMap<String, String>,
        part: &'a Path,
        expected: Option<u64>,
    ) -> Request<'a> {
        Request {
            url,
            headers,
            part,
            expected,
            kind: Kind::Audio,
        }
    }

    #[tokio::test]
    async fn cancel_does_not_wait_for_a_stalled_server() {
        // Accepts the connection and never answers.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let _server = tokio::spawn(async move {
            let _conn = listener.accept().await;
            std::future::pending::<()>().await;
        });
        let part = temp_dir("stall").with_extension("part");
        let headers = HashMap::new();
        let token = CancellationToken::new();
        let cancel = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            cancel.cancel();
        });
        let started = Instant::now();
        let err = fetch(
            &audio_request(&url, &headers, &part, None),
            &token,
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(err.kind, ErrorKind::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    /// Against the test Audiobookshelf server; run with `cargo test -- --ignored`.
    mod live {
        use super::*;
        use std::sync::{Arc, Mutex as StdMutex};

        const BASE: &str = "http://localhost:13378";

        struct Track {
            url: String,
            headers: HashMap<String, String>,
            bytes: Vec<u8>,
            etag: String,
        }

        async fn first_multi_file_track() -> Track {
            let client = reqwest::Client::new();
            let login: serde_json::Value = client
                .post(format!("{BASE}/login"))
                .header("x-return-tokens", "true")
                .header(header::CONTENT_TYPE, "application/json")
                .body(r#"{"username":"root","password":"lectern"}"#)
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .map(|b| serde_json::from_slice::<serde_json::Value>(&b).unwrap())
                .unwrap();
            let token = login["user"]["accessToken"].as_str().unwrap().to_string();
            let get = |path: String| {
                client
                    .get(format!("{BASE}{path}"))
                    .bearer_auth(&token)
                    .send()
            };
            let libs: serde_json::Value = get("/api/libraries".into())
                .await
                .unwrap()
                .bytes()
                .await
                .map(|b| serde_json::from_slice::<serde_json::Value>(&b).unwrap())
                .unwrap();
            let lib = libs["libraries"]
                .as_array()
                .unwrap()
                .iter()
                .find(|l| l["mediaType"] == "book")
                .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string();
            let items: serde_json::Value = get(format!("/api/libraries/{lib}/items"))
                .await
                .unwrap()
                .bytes()
                .await
                .map(|b| serde_json::from_slice::<serde_json::Value>(&b).unwrap())
                .unwrap();
            let item = items["results"]
                .as_array()
                .unwrap()
                .iter()
                .find(|i| i["media"]["numAudioFiles"].as_u64() >= Some(2))
                .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string();
            let full: serde_json::Value = get(format!("/api/items/{item}"))
                .await
                .unwrap()
                .bytes()
                .await
                .map(|b| serde_json::from_slice::<serde_json::Value>(&b).unwrap())
                .unwrap();
            let ino = full["media"]["audioFiles"][0]["ino"].as_str().unwrap();
            let url = format!("{BASE}/api/items/{item}/file/{ino}");
            let response = get(format!("/api/items/{item}/file/{ino}")).await.unwrap();
            let etag = response.headers()[header::ETAG]
                .to_str()
                .unwrap()
                .to_string();
            let bytes = response.bytes().await.unwrap().to_vec();
            let headers = HashMap::from([("Authorization".to_string(), format!("Bearer {token}"))]);
            Track {
                url,
                headers,
                bytes,
                etag,
            }
        }

        async fn run(
            track: &Track,
            part: &Path,
            expected: Option<u64>,
        ) -> (Result<(), DownloadError>, Vec<u64>) {
            let seen = Arc::new(StdMutex::new(Vec::new()));
            let log = seen.clone();
            let result = fetch(
                &audio_request(&track.url, &track.headers, part, expected),
                &CancellationToken::new(),
                move |received, _| log.lock().unwrap().push(received),
            )
            .await;
            let seen = seen.lock().unwrap().clone();
            (result, seen)
        }

        #[tokio::test]
        #[ignore]
        async fn resumes_restarts_and_verifies_against_the_server() {
            let track = first_multi_file_track().await;
            let size = track.bytes.len() as u64;
            let dir = temp_dir("live");
            fs::create_dir_all(&dir).unwrap();
            let part = dir.join("001.mp3.part");

            // Resume: the server sends only the rest.
            fs::write(&part, &track.bytes[..1000]).unwrap();
            fs::write(validator_path(&part), &track.etag).unwrap();
            let (result, seen) = run(&track, &part, Some(size)).await;
            assert_eq!(result, Ok(()));
            assert_eq!(seen.first(), Some(&1000));
            assert_eq!(fs::read(&part).unwrap(), track.bytes);

            // The file changed since (validator mismatch): the server sends it all and we start over.
            fs::write(&part, vec![0u8; 1000]).unwrap();
            fs::write(validator_path(&part), "W/\"stale\"").unwrap();
            let (result, seen) = run(&track, &part, Some(size)).await;
            assert_eq!(result, Ok(()));
            assert_eq!(seen.first(), Some(&0));
            assert_eq!(fs::read(&part).unwrap(), track.bytes);

            // Already complete: 416 and nothing more to fetch.
            let (result, _) = run(&track, &part, Some(size)).await;
            assert_eq!(result, Ok(()));

            // The library says otherwise: refuse before writing anything.
            discard_part(&part).await;
            let (result, _) = run(&track, &part, Some(size + 1)).await;
            assert_eq!(result.unwrap_err().kind, ErrorKind::Invalid);

            // A web page is not an audio file.
            let page = Track {
                url: format!("{BASE}/"),
                ..track
            };
            let (result, _) = run(&page, &part, None).await;
            assert_eq!(result.unwrap_err().kind, ErrorKind::Invalid);
            fs::remove_dir_all(&dir).unwrap();
        }
    }
}
