// Offline downloads: resumable, checked for completeness, written beside their meta.json under
// `<app data>/downloads/<dir>/`. The page decides what to download and when to retry; this file does one file at a
// time and says exactly what went wrong.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { open, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { emit } from './events';
import { downloadsRoot } from './paths';

const PROGRESS_INTERVAL_MS = 200;
/** Folders without a meta.json younger than this may be a download that is just starting. */
export const ORPHAN_AGE_MS = 10 * 60 * 1000;
/** No bytes for this long counts as a dropped connection. */
const IDLE_TIMEOUT_MS = 60_000;

export type ErrorKind = 'cancelled' | 'network' | 'http' | 'invalid' | 'io';

/** What the page receives when a download fails: `{ kind, message, status? }`. */
export class DownloadError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
  }

  toJSON() {
    return this.status === undefined ? { kind: this.kind, message: this.message } : { kind: this.kind, message: this.message, status: this.status };
  }

  static cancelled() {
    return new DownloadError('cancelled', 'cancelled');
  }

  static io(err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOSPC') return new DownloadError('io', 'The disk is full');
    return new DownloadError('io', err instanceof Error ? err.message : String(err));
  }

  static http(status: number) {
    const message =
      status === 401
        ? 'The server no longer accepts this sign-in'
        : status === 403
          ? "This account isn't allowed to download this title"
          : status === 404
            ? 'The file is no longer on the server'
            : `The server answered HTTP ${status}`;
    return new DownloadError('http', message, status);
  }
}

/** Accepts only a single plain path segment so callers cannot escape `downloads/`. */
export function segment(name: string, what: string): string {
  if (!name || name.startsWith('.') || name.includes('..') || /[/\\\0]/.test(name)) throw new Error(`invalid ${what}`);
  return name;
}

// ---------------------------------------------------------------------------
// In-flight attempts. Every call to `download_file` is one attempt with an id that the page never reuses, so a cancel
// can't leak into a later attempt, and a cancel that arrives before its attempt has started still stops it.

interface Attempt {
  serial: number;
  part: string;
  abort: AbortController;
  /** Settles when the attempt has finished with the file. */
  done: Promise<void>;
}

const attempts = new Map<string, Attempt>();
const cancelledEarly = new Set<string>();
let serialCounter = 0;

/** Serializes meta writes against folder removal, so a late write can't land in a deleted folder. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
}
const dirLock = new Mutex();

export interface Registration {
  signal: AbortSignal;
  /** Let go of the file: wakes everyone waiting for this attempt to end. */
  release(): void;
}

/**
 * Registers an attempt, first stopping (and waiting out) any other attempt writing the same file, e.g. one left
 * running by a reloaded page.
 */
export async function register(id: string, part: string): Promise<Registration> {
  for (;;) {
    if (cancelledEarly.delete(id)) throw DownloadError.cancelled();
    const clashes = [...attempts.entries()].filter(([other, a]) => other === id || a.part === part).map(([, a]) => a);
    if (clashes.length === 0) {
      const serial = ++serialCounter;
      const abort = new AbortController();
      let finish!: () => void;
      const done = new Promise<void>((resolve) => (finish = resolve));
      attempts.set(id, { serial, part, abort, done });
      return {
        signal: abort.signal,
        release() {
          if (attempts.get(id)?.serial === serial) attempts.delete(id);
          finish();
        }
      };
    }
    for (const a of clashes) a.abort.abort();
    await Promise.all(clashes.map((a) => a.done));
  }
}

/** Cancels the matching attempts and returns once they have let go of their files. */
async function cancelWhere(pred: (id: string, a: Attempt) => boolean) {
  const hit = [...attempts.entries()].filter(([id, a]) => pred(id, a)).map(([, a]) => a);
  for (const a of hit) a.abort.abort();
  await Promise.all(hit.map((a) => a.done));
}

/** Stops an attempt and returns once it has closed its file. */
export async function cancelDownload(id: string) {
  const a = attempts.get(id);
  if (!a) {
    // Not started yet (or already over): make sure it never starts.
    cancelledEarly.add(id);
    return;
  }
  a.abort.abort();
  await a.done;
}

// ---------------------------------------------------------------------------
// Pure decisions, kept apart from I/O so they can be tested.

/** Where to resume from given the bytes already in the .part file (0 means start over). */
export function resumeOffset(existing: number, expected: number | null | undefined): number {
  return expected != null && existing > expected ? 0 : existing;
}

// `bytes 100-199/1000` gives start 100 and total 1000; an unsatisfied range (`bytes */1000`) gives no start.
// `undefined` if it isn't a byte range at all.
export function parseContentRange(value: string): { start: number | null; total: number | null } | undefined {
  const rest = /^\s*bytes\s*(.*)$/.exec(value)?.[1];
  if (rest === undefined) return undefined;
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  const range = rest.slice(0, slash).trim();
  const totalText = rest.slice(slash + 1).trim();
  const num = /^\d+$/;
  let total: number | null = null;
  if (totalText !== '*') {
    if (!num.test(totalText)) return undefined;
    total = Number(totalText);
  }
  let start: number | null = null;
  if (range !== '*') {
    const first = range.split('-')[0]?.trim() ?? '';
    if (!range.includes('-') || !num.test(first)) return undefined;
    start = Number(first);
  }
  return { start, total };
}

export type Start =
  /** Write from `offset` (0 truncates); `total` is the size of the whole file if known. */
  | { kind: 'at'; offset: number; total: number | null }
  /** The .part already holds the whole file. */
  | { kind: 'complete' }
  /** The server can't continue from where we are; the .part has to go. */
  | { kind: 'restart' };

export function interpretResponse(status: number, offset: number, contentRange: string | null, contentLength: number | null): Start {
  const range = contentRange ? parseContentRange(contentRange) : undefined;
  switch (status) {
    case 200:
      return { kind: 'at', offset: 0, total: contentLength };
    case 206:
      if (range && range.start === offset) {
        return { kind: 'at', offset, total: range.total ?? (contentLength === null ? null : contentLength + offset) };
      }
      return { kind: 'restart' };
    case 416:
      return range && range.start === null && range.total === offset && offset > 0 ? { kind: 'complete' } : { kind: 'restart' };
    default:
      throw DownloadError.http(status);
  }
}

export type MediaKind = 'audio' | 'image';

/** Rejects responses that are plainly not the media we asked for, e.g. a proxy's HTML sign-in page. */
export function contentTypeOk(kind: MediaKind, contentType: string | null | undefined): boolean {
  if (contentType == null) return true;
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (kind === 'image') return mime.startsWith('image/');
  return !(mime.startsWith('text/') || mime === 'application/json' || mime.endsWith('+json') || mime.endsWith('/xml') || mime.endsWith('+xml'));
}

/** Checks a finished file against what the server announced and what the library metadata says. */
export function verifySize(len: number, total: number | null, expected: number | null | undefined): void {
  if (total != null) {
    if (len < total) throw new DownloadError('network', 'The connection ended before the file was complete');
    if (len > total) throw new DownloadError('invalid', `Received ${len} bytes but the server announced ${total}`);
  }
  if (expected != null && expected !== len) throw new DownloadError('invalid', `Received ${len} bytes but the library lists ${expected}`);
}

let tmpSeq = 0;

/**
 * Writes `name` in `dir` via a temp file and rename, so readers never see half a file. With `create` false a missing
 * folder is left missing: the download was deleted. Returns whether anything was written.
 */
export function writeAtomic(dir: string, name: string, contents: string | Uint8Array, create: boolean): boolean {
  if (create) mkdirSync(dir, { recursive: true });
  else if (!isDir(dir)) return false;
  const tmp = join(dir, `${name}.${tmpSeq++}.tmp`);
  try {
    writeFileSync(tmp, contents);
    renameSync(tmp, join(dir, name));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return true;
}

function isDir(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

export interface FetchRequest {
  url: string;
  headers: Record<string, string>;
  part: string;
  expected: number | null;
  kind: MediaKind;
}

const validatorPath = (part: string) => `${part}.validator`;

async function discardPart(part: string) {
  await rm(part, { force: true });
  await rm(validatorPath(part), { force: true });
}

async function fileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function networkError(err: unknown, timedOut: boolean) {
  if (timedOut) return new DownloadError('network', 'The connection timed out');
  const text = `${(err as { code?: string } | null)?.code ?? ''} ${err instanceof Error ? err.message : String(err)}`;
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|Unable to connect|ConnectionRefused|FailedToOpenSocket|typo in the url/i.test(text)) {
    return new DownloadError('network', "Couldn't reach the server");
  }
  return new DownloadError('network', `The connection dropped (${err instanceof Error ? err.message : String(err)})`);
}

/** Streams the file into its .part, resuming from what is already there when the server allows. */
export async function fetchPart(req: FetchRequest, signal: AbortSignal, progress: (received: number, total: number | null) => void): Promise<void> {
  const existing = await fileSize(req.part);
  const offset = resumeOffset(existing, req.expected);
  const validator = offset > 0 ? await readFile(validatorPath(req.part), 'utf8').catch(() => null) : null;

  const headers = new Headers(req.headers);
  // Sizes are checked against the bytes on the wire: no transparent compression.
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');
  if (offset > 0) {
    headers.set('range', `bytes=${offset}-`);
    // Only continue if the file is still the one we started on; otherwise the server sends it all.
    if (validator) headers.set('if-range', validator.trim());
  }

  const ctrl = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, IDLE_TIMEOUT_MS);
  };
  const onAbort = () => ctrl.abort();
  if (signal.aborted) throw DownloadError.cancelled();
  signal.addEventListener('abort', onAbort, { once: true });
  const guard = (err: unknown): never => {
    if (signal.aborted) throw DownloadError.cancelled();
    throw networkError(err, timedOut);
  };

  try {
    arm();
    let response: Response;
    try {
      response = await fetch(req.url, { headers, signal: ctrl.signal, redirect: 'follow' });
    } catch (err) {
      return guard(err);
    }

    const text = (name: string) => response.headers.get(name);
    const length = text('content-length');
    let start: Start;
    try {
      start = interpretResponse(response.status, offset, text('content-range'), length === null || !/^\d+$/.test(length) ? null : Number(length));
    } catch (err) {
      await response.body?.cancel().catch(() => {});
      throw err;
    }
    if (start.kind === 'complete') {
      await response.body?.cancel().catch(() => {});
      return await verifyPart(req.part, existing, req.expected);
    }
    if (start.kind === 'restart') {
      await response.body?.cancel().catch(() => {});
      await discardPart(req.part);
      throw new DownloadError('network', "The server couldn't resume this file");
    }
    const { offset: from, total } = start;
    if (!contentTypeOk(req.kind, text('content-type'))) {
      await response.body?.cancel().catch(() => {});
      throw new DownloadError('invalid', `The server sent ${text('content-type') ?? 'something else'} instead of the file`);
    }
    if (total != null && req.expected != null && total !== req.expected) {
      await response.body?.cancel().catch(() => {});
      throw new DownloadError('invalid', `The server offered ${total} bytes but the library lists ${req.expected}`);
    }
    const etag = text('etag') ?? text('last-modified');

    // Start reading before the file is opened: if the connection drops meanwhile, bytes nobody has asked for yet
    // can be lost along with it.
    const reader = response.body?.getReader();
    let next = reader?.read();
    next?.catch(() => {});

    let file;
    try {
      if (from > 0) file = await open(req.part, 'a');
      else {
        file = await open(req.part, 'w');
        if (etag) await writeFile(validatorPath(req.part), etag);
        else await rm(validatorPath(req.part), { force: true });
      }
    } catch (err) {
      await reader?.cancel().catch(() => {});
      throw DownloadError.io(err);
    }

    let received = from;
    let lastEmit = Date.now();
    progress(received, total);
    let streamed: DownloadError | null = null;
    try {
      while (reader && next) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await next;
        } catch (err) {
          streamed = signal.aborted ? DownloadError.cancelled() : networkError(err, timedOut);
          break;
        }
        if (chunk.done) break;
        next = reader.read();
        next.catch(() => {});
        arm();
        try {
          await file.write(chunk.value);
        } catch (err) {
          streamed = DownloadError.io(err);
          ctrl.abort();
          break;
        }
        received += chunk.value.byteLength;
        if (Date.now() - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = Date.now();
          progress(received, total);
        }
      }
    } finally {
      // Whatever happened, what reached the disk stays for the next attempt to resume from. Closing the file here
      // also makes sure it can be deleted straight away on Windows.
      let flushError: DownloadError | null = null;
      try {
        await file.sync();
      } catch (err) {
        flushError = DownloadError.io(err);
      }
      await file.close().catch(() => {});
      if (!streamed && flushError) streamed = flushError;
    }
    if (streamed) throw streamed;
    progress(received, total);
    await verifyPart(req.part, total, req.expected);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Checks the finished .part; one that came out the wrong size can't be resumed, so it goes. */
async function verifyPart(part: string, total: number | null, expected: number | null | undefined) {
  let len: number;
  try {
    len = (await stat(part)).size;
  } catch (err) {
    throw DownloadError.io(err);
  }
  try {
    verifySize(len, total, expected);
  } catch (err) {
    if (err instanceof DownloadError && err.kind === 'invalid') await discardPart(part);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Commands

export interface DownloadFileArgs {
  id: string;
  url: string;
  headers?: Record<string, string>;
  dir: string;
  fileName: string;
  expectedSize?: number | null;
  kind?: string | null;
}

export async function downloadFile(args: DownloadFileArgs, root = downloadsRoot()): Promise<string> {
  let dirPath: string, fileName: string;
  try {
    dirPath = join(root, segment(args.dir, 'dir'));
    fileName = segment(args.fileName, 'file name');
  } catch (err) {
    throw new DownloadError('io', (err as Error).message);
  }
  const target = join(dirPath, fileName);
  const part = join(dirPath, `${fileName}.part`);

  const reg = await register(args.id, part);
  try {
    // The folder is created with the download's meta; if it's gone, the download was deleted.
    if (!isDir(dirPath)) throw DownloadError.cancelled();
    await fetchPart(
      {
        url: args.url,
        headers: args.headers ?? {},
        part,
        expected: args.expectedSize && args.expectedSize > 0 ? args.expectedSize : null,
        kind: args.kind === 'image' ? 'image' : 'audio'
      },
      reg.signal,
      (received, total) => emit('download-progress', { id: args.id, received, total })
    );
    try {
      await rename(part, target);
    } catch (err) {
      throw DownloadError.io(err);
    }
    await rm(validatorPath(part), { force: true });
    return target;
  } finally {
    reg.release();
  }
}

export async function writeDownloadMeta(args: { dir: string; json: string; create?: boolean }, root = downloadsRoot()): Promise<boolean> {
  const dirPath = join(root, segment(args.dir, 'dir'));
  return dirLock.run(() => writeAtomic(dirPath, 'meta.json', args.json, args.create === true));
}

export async function listDownloadMeta(root = downloadsRoot()): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const metas = await Promise.all(entries.map((name) => readFile(join(root, name, 'meta.json'), 'utf8').catch(() => null)));
  return metas.filter((m): m is string => m !== null);
}

export async function removeDownload(args: { dir: string }, root = downloadsRoot()): Promise<void> {
  const dirPath = join(root, segment(args.dir, 'dir'));
  // Open files can't be deleted on Windows: let every attempt in this folder finish first.
  await cancelWhere((_, a) => dirname(a.part) === dirPath);
  await dirLock.run(() => rm(dirPath, { recursive: true, force: true }));
}

/** Deletes folders that have no meta.json (a download that never got going) and stray temp files. */
export function prune(root: string, now: number): number {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  const busy = new Set([...attempts.values()].map((a) => dirname(a.part)));
  let removed = 0;
  for (const name of entries) {
    const path = join(root, name);
    if (!isDir(path) || busy.has(path)) continue;
    if (existsSync(join(path, 'meta.json'))) {
      for (const f of readdirSync(path)) {
        if (f.startsWith('meta.json.') && f.endsWith('.tmp')) rmSync(join(path, f), { force: true });
      }
      continue;
    }
    const age = now - statSync(path).mtimeMs;
    if (age >= ORPHAN_AGE_MS) {
      try {
        rmSync(path, { recursive: true });
        removed++;
      } catch {
        // Still in use; next time.
      }
    }
  }
  return removed;
}

export function pruneDownloads(root = downloadsRoot()): Promise<number> {
  return dirLock.run(() => prune(root, Date.now()));
}

export function dirSize(path: string): number {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const child = join(path, entry.name);
    try {
      total += entry.isDirectory() ? dirSize(child) : statSync(child).size;
    } catch {
      // Gone since we listed it.
    }
  }
  return total;
}

export const downloadsUsage = async (root = downloadsRoot()) => dirSize(root);

/** Free bytes on the disk that holds the downloads folder. */
export async function downloadsFreeSpace(root = downloadsRoot()): Promise<number> {
  // The folder may not exist yet: ask about the nearest ancestor that does.
  let existing = root;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const s = await statfs(existing);
  return Number(s.bavail) * Number(s.bsize);
}
