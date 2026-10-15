use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, async_runtime::spawn_blocking};
use tauri_plugin_http::reqwest;
use tokio::{fs::File, io::AsyncWriteExt};

use crate::app_state::AppState;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    received: u64,
    total: Option<u64>,
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

async fn stream_to_part(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    url: &str,
    headers: &HashMap<String, String>,
    part: &Path,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(name.as_str(), value.as_str());
    }
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }

    let total = response.content_length();
    let mut file = File::create(part).await.map_err(|e| e.to_string())?;
    let mut received = 0u64;
    let mut last_emit = Instant::now();

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if state.cancels.lock().unwrap().remove(id) {
            return Err("cancelled".into());
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            last_emit = Instant::now();
            let _ = app.emit(
                "download-progress",
                Progress {
                    id,
                    received,
                    total,
                },
            );
        }
    }
    if state.cancels.lock().unwrap().remove(id) {
        return Err("cancelled".into());
    }
    file.flush().await.map_err(|e| e.to_string())?;
    let _ = app.emit(
        "download-progress",
        Progress {
            id,
            received,
            total,
        },
    );
    Ok(received)
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
    headers: HashMap<String, String>,
    dir: String,
    file_name: String,
) -> Result<String, String> {
    let dir_path = downloads_root(&app)?.join(segment(&dir, "dir")?);
    let file_name = segment(&file_name, "file name")?;
    let target = dir_path.join(file_name);
    let part = dir_path.join(format!("{file_name}.part"));

    tokio::fs::create_dir_all(&dir_path)
        .await
        .map_err(|e| e.to_string())?;
    // A stale cancel for a reused id must not abort a fresh attempt.
    state.cancels.lock().unwrap().remove(&id);

    let result = stream_to_part(&app, &state, &id, &url, &headers, &part).await;
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(e);
    }
    if let Err(e) = tokio::fs::rename(&part, &target).await {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(e.to_string());
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, id: String) {
    state.cancels.lock().unwrap().insert(id);
}

#[tauri::command]
pub async fn write_download_meta(app: AppHandle, dir: String, json: String) -> Result<(), String> {
    let dir_path = downloads_root(&app)?.join(segment(&dir, "dir")?);
    tokio::fs::create_dir_all(&dir_path)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(dir_path.join("meta.json"), json)
        .await
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
    match tokio::fs::remove_dir_all(dir_path).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
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
