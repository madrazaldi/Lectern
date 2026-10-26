import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cancelDownload,
  contentTypeOk,
  DownloadError,
  downloadFile,
  downloadsFreeSpace,
  downloadsUsage,
  fetchPart,
  interpretResponse,
  listDownloadMeta,
  ORPHAN_AGE_MS,
  parseContentRange,
  prune,
  register,
  removeDownload,
  resumeOffset,
  segment,
  verifySize,
  writeAtomic,
  writeDownloadMeta
} from './downloads';

const scratch = mkdtempSync(join(tmpdir(), 'lectern-dl-test-'));
let n = 0;
const tempDir = (name: string) => {
  const dir = join(scratch, `${name}-${n++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const kindOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof DownloadError ? err.kind : 'other';
  }
  return 'none';
};

describe('pure decisions', () => {
  it('resumes from what is on disk', () => {
    expect(resumeOffset(0, 100)).toBe(0);
    expect(resumeOffset(40, 100)).toBe(40);
    expect(resumeOffset(40, null)).toBe(40);
    expect(resumeOffset(100, 100)).toBe(100);
    // Bigger than the file should be: it can't be the right file.
    expect(resumeOffset(140, 100)).toBe(0);
  });

  it('parses Content-Range', () => {
    expect(parseContentRange('bytes 100-960444/960445')).toEqual({ start: 100, total: 960445 });
    expect(parseContentRange('bytes */960445')).toEqual({ start: null, total: 960445 });
    expect(parseContentRange('bytes 0-9/*')).toEqual({ start: 0, total: null });
    expect(parseContentRange('items 0-9/10')).toBeUndefined();
    expect(parseContentRange('bytes x-9/10')).toBeUndefined();
  });

  it('appends when the server honours the range', () => {
    expect(interpretResponse(206, 100, 'bytes 100-960444/960445', 960345)).toEqual({ kind: 'at', offset: 100, total: 960445 });
    // No total in Content-Range: work it out from the length.
    expect(interpretResponse(206, 100, 'bytes 100-199/*', 100)).toEqual({ kind: 'at', offset: 100, total: 200 });
  });

  it('starts over when the server ignores the range', () => {
    expect(interpretResponse(200, 100, null, 960445)).toEqual({ kind: 'at', offset: 0, total: 960445 });
    expect(interpretResponse(206, 100, 'bytes 0-99/1000', 100)).toEqual({ kind: 'restart' });
    expect(interpretResponse(206, 100, null, 100)).toEqual({ kind: 'restart' });
  });

  it('knows a complete .part needs no more bytes', () => {
    expect(interpretResponse(416, 960445, 'bytes */960445', 148)).toEqual({ kind: 'complete' });
    expect(interpretResponse(416, 500, 'bytes */960445', 148)).toEqual({ kind: 'restart' });
  });

  it('reports HTTP errors with their status', () => {
    try {
      interpretResponse(401, 0, null, 12);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DownloadError);
      expect((err as DownloadError).toJSON()).toEqual({ kind: 'http', message: 'The server no longer accepts this sign-in', status: 401 });
    }
    expect(DownloadError.http(404).message).toBe('The file is no longer on the server');
    expect(DownloadError.http(500).message).toBe('The server answered HTTP 500');
  });

  it('rejects pages that are not media', () => {
    expect(contentTypeOk('audio', 'audio/mpeg')).toBe(true);
    expect(contentTypeOk('audio', 'video/mp4')).toBe(true);
    expect(contentTypeOk('audio', 'application/octet-stream')).toBe(true);
    expect(contentTypeOk('audio', null)).toBe(true);
    expect(contentTypeOk('audio', 'text/html; charset=utf-8')).toBe(false);
    expect(contentTypeOk('audio', 'application/json')).toBe(false);
    expect(contentTypeOk('audio', 'application/xhtml+xml')).toBe(false);
    expect(contentTypeOk('image', 'image/jpeg')).toBe(true);
    expect(contentTypeOk('image', 'text/plain; charset=utf-8')).toBe(false);
  });

  it('verifies the finished size', () => {
    expect(kindOf(() => verifySize(100, 100, 100))).toBe('none');
    expect(kindOf(() => verifySize(100, null, null))).toBe('none');
    expect(kindOf(() => verifySize(60, 100, 100))).toBe('network');
    expect(kindOf(() => verifySize(120, 100, null))).toBe('invalid');
    expect(kindOf(() => verifySize(100, 100, 90))).toBe('invalid');
  });

  it('accepts only a single plain path segment', () => {
    expect(segment('abc-1_2', 'dir')).toBe('abc-1_2');
    for (const bad of ['', '.hidden', 'a/b', 'a\\b', '..', 'a..b', 'a\0b']) expect(() => segment(bad, 'dir')).toThrow('invalid dir');
  });
});

describe('files', () => {
  it('writes meta atomically and never recreates a deleted folder', () => {
    const dir = join(tempDir('meta'), 'folder');
    expect(writeAtomic(dir, 'meta.json', '{}', false)).toBe(false);
    expect(existsSync(dir)).toBe(false);

    expect(writeAtomic(dir, 'meta.json', '{"a":1}', true)).toBe(true);
    expect(writeAtomic(dir, 'meta.json', '{"a":2}', false)).toBe(true);
    expect(readFileSync(join(dir, 'meta.json'), 'utf8')).toBe('{"a":2}');
    expect(readdirSync(dir).filter((f) => f !== 'meta.json')).toEqual([]);
  });

  it('prunes only old folders without meta', () => {
    const root = tempDir('prune');
    mkdirSync(join(root, 'kept'));
    writeFileSync(join(root, 'kept/meta.json'), '{}');
    writeFileSync(join(root, 'kept/meta.json.3.tmp'), '{');
    writeFileSync(join(root, 'kept/001.mp3.part'), 'abc');
    mkdirSync(join(root, 'orphan'));
    writeFileSync(join(root, 'orphan/001.mp3.part'), 'abc');

    // Young orphans may be a download that is just starting.
    expect(prune(root, Date.now())).toBe(0);
    const later = Date.now() + ORPHAN_AGE_MS * 2;
    expect(prune(root, later)).toBe(1);
    expect(existsSync(join(root, 'orphan'))).toBe(false);
    expect(existsSync(join(root, 'kept/001.mp3.part'))).toBe(true);
    expect(existsSync(join(root, 'kept/meta.json.3.tmp'))).toBe(false);
  });

  it('prunes by the folder age on disk', () => {
    const root = tempDir('prune-age');
    mkdirSync(join(root, 'old'));
    const longAgo = new Date(Date.now() - ORPHAN_AGE_MS * 3);
    utimesSync(join(root, 'old'), longAgo, longAgo);
    expect(prune(root, Date.now())).toBe(1);
  });

  it('reports free space and usage', async () => {
    expect(await downloadsFreeSpace(join(tempDir('free'), 'not', 'there', 'yet'))).toBeGreaterThan(0);
    const root = tempDir('usage');
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a/x'), 'hello');
    writeFileSync(join(root, 'a/y'), 'world!');
    expect(await downloadsUsage(root)).toBe(11);
    expect(await downloadsUsage(join(root, 'missing'))).toBe(0);
  });

  it('lists meta, writes it only where the folder exists, and removes a download', async () => {
    const root = tempDir('meta-cmds');
    expect(await writeDownloadMeta({ dir: 'one', json: '{"id":1}' }, root)).toBe(false);
    expect(await writeDownloadMeta({ dir: 'one', json: '{"id":1}', create: true }, root)).toBe(true);
    expect(await writeDownloadMeta({ dir: 'one', json: '{"id":2}' }, root)).toBe(true);
    mkdirSync(join(root, 'empty'));
    expect(await listDownloadMeta(root)).toEqual(['{"id":2}']);
    await removeDownload({ dir: 'one' }, root);
    await removeDownload({ dir: 'one' }, root);
    expect(await listDownloadMeta(root)).toEqual([]);
    await expect(writeDownloadMeta({ dir: '../x', json: '{}' }, root)).rejects.toThrow('invalid dir');
  });
});

describe('attempts', () => {
  it('cancelling before start stops only that attempt', async () => {
    const part = join(tempDir('early'), 'f.part');
    await cancelDownload('early@1');
    await expect(register('early@1', part)).rejects.toMatchObject({ kind: 'cancelled' });
    // A later attempt for the same file is unaffected.
    const reg = await register('early@2', part);
    expect(reg.signal.aborted).toBe(false);
    reg.release();
  });

  it('a new attempt on the same file waits for the old one', async () => {
    const part = join(tempDir('clash'), 'f.part');
    const old = await register('clash@1', part);
    let oldReleasedAt = 0;
    old.signal.addEventListener('abort', () =>
      setTimeout(() => {
        oldReleasedAt = performance.now();
        old.release();
      }, 20)
    );
    const next = await register('clash@2', part);
    expect(oldReleasedAt).toBeGreaterThan(0);
    expect(next.signal.aborted).toBe(false);
    expect(old.signal.aborted).toBe(true);
    next.release();
  });

  it('cancel waits for the attempt to finish', async () => {
    const part = join(tempDir('wait'), 'f.part');
    const reg = await register('wait@1', part);
    let releasedAt = 0;
    reg.signal.addEventListener('abort', () =>
      setTimeout(() => {
        releasedAt = performance.now();
        reg.release();
      }, 20)
    );
    await cancelDownload('wait@1');
    expect(releasedAt).toBeGreaterThan(0);
  });

  it('removing a download stops the attempts writing into it first', async () => {
    const root = tempDir('remove-busy');
    mkdirSync(join(root, 'busy'));
    const reg = await register('busy@1', join(root, 'busy', 'f.part'));
    let released = false;
    reg.signal.addEventListener('abort', () =>
      setTimeout(() => {
        released = true;
        reg.release();
      }, 20)
    );
    await removeDownload({ dir: 'busy' }, root);
    expect(released).toBe(true);
    expect(existsSync(join(root, 'busy'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against a local server that behaves like Audiobookshelf's file endpoint.

const BODY = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
let etag = '"v1"';
let requests: { range: string | null; ifRange: string | null }[] = [];
let mode: 'normal' | 'ignore-range' | 'html' | 'stall' | 'status' = 'normal';
let status = 500;
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const range = req.headers.get('range');
      const ifRange = req.headers.get('if-range');
      requests.push({ range, ifRange });
      const headers = { 'content-type': 'audio/mpeg', etag, 'accept-ranges': 'bytes' };
      if (mode === 'html') return new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } });
      if (mode === 'status') return new Response('no', { status });
      if (mode === 'stall') return new Promise<Response>(() => {});
      if (range && mode === 'normal' && (!ifRange || ifRange === etag)) {
        const start = Number(/bytes=(\d+)-/.exec(range)![1]);
        if (start >= BODY.length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${BODY.length}` } });
        return new Response(BODY.slice(start), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${BODY.length - 1}/${BODY.length}` } });
      }
      return new Response(BODY, { headers });
    }
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));
afterEach(() => {
  mode = 'normal';
  etag = '"v1"';
  requests = [];
});

const noProgress = () => {};
const request = (part: string, expected: number | null = BODY.length) => ({ url: `${base}/file`, headers: {}, part, expected, kind: 'audio' as const });
const ctl = () => new AbortController().signal;

describe('fetchPart', () => {
  it('downloads a whole file', async () => {
    const part = join(tempDir('whole'), 'a.part');
    const seen: number[] = [];
    await fetchPart(request(part), ctl(), (received) => seen.push(received));
    expect(readFileSync(part)).toEqual(Buffer.from(BODY));
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(BODY.length);
    expect(requests[0]?.range).toBeNull();
  });

  it('resumes: the server sends only the rest', async () => {
    const part = join(tempDir('resume'), 'a.part');
    writeFileSync(part, BODY.slice(0, 1000));
    writeFileSync(`${part}.validator`, '"v1"');
    const seen: number[] = [];
    await fetchPart(request(part), ctl(), (received) => seen.push(received));
    expect(seen[0]).toBe(1000);
    expect(readFileSync(part)).toEqual(Buffer.from(BODY));
    expect(requests[0]).toEqual({ range: 'bytes=1000-', ifRange: '"v1"' });
  });

  it('starts over when the file changed since (validator mismatch)', async () => {
    const part = join(tempDir('changed'), 'a.part');
    writeFileSync(part, new Uint8Array(1000));
    writeFileSync(`${part}.validator`, 'W/"stale"');
    const seen: number[] = [];
    await fetchPart(request(part), ctl(), (received) => seen.push(received));
    expect(seen[0]).toBe(0);
    expect(readFileSync(part)).toEqual(Buffer.from(BODY));
    expect(readFileSync(`${part}.validator`, 'utf8')).toBe('"v1"');
  });

  it('starts over when the server ignores the range', async () => {
    mode = 'ignore-range';
    const part = join(tempDir('ignore'), 'a.part');
    writeFileSync(part, BODY.slice(0, 500));
    await fetchPart(request(part), ctl(), noProgress);
    expect(readFileSync(part)).toEqual(Buffer.from(BODY));
  });

  it('accepts a .part that is already complete (416)', async () => {
    const part = join(tempDir('complete'), 'a.part');
    writeFileSync(part, BODY);
    await fetchPart(request(part), ctl(), noProgress);
    expect(readFileSync(part)).toEqual(Buffer.from(BODY));
  });

  it('refuses a file the library lists at another size, before writing anything', async () => {
    const part = join(tempDir('size'), 'a.part');
    await expect(fetchPart(request(part, BODY.length + 1), ctl(), noProgress)).rejects.toMatchObject({ kind: 'invalid' });
    expect(existsSync(part)).toBe(false);
  });

  it('discards a .part that grew past what the library lists', async () => {
    const part = join(tempDir('toobig'), 'a.part');
    writeFileSync(part, new Uint8Array(BODY.length + 50));
    await fetchPart(request(part), ctl(), noProgress);
    // Too big to be a prefix of the right file: started again from nothing.
    expect(readFileSync(part)).toEqual(Buffer.from(BODY));
  });

  it('does not accept a web page for an audio file', async () => {
    mode = 'html';
    const part = join(tempDir('html'), 'a.part');
    await expect(fetchPart(request(part, null), ctl(), noProgress)).rejects.toMatchObject({ kind: 'invalid' });
    expect(existsSync(part)).toBe(false);
  });

  it('reports HTTP errors', async () => {
    mode = 'status';
    status = 403;
    const part = join(tempDir('http'), 'a.part');
    await expect(fetchPart(request(part), ctl(), noProgress)).rejects.toMatchObject({
      kind: 'http',
      status: 403,
      message: "This account isn't allowed to download this title"
    });
  });

  it('keeps a truncated download for resuming and calls it a network error', async () => {
    // Promises the whole file, sends a part of it, and hangs up.
    const cutOff = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        data(socket) {
          socket.write(`HTTP/1.1 200 OK\r\ncontent-type: audio/mpeg\r\ncontent-length: ${BODY.length}\r\n\r\n`);
          socket.write(BODY.slice(0, 1000));
          socket.end();
        }
      }
    });
    const part = join(tempDir('short'), 'a.part');
    const err = await fetchPart({ ...request(part), url: `http://127.0.0.1:${cutOff.port}/file` }, ctl(), noProgress).catch((e) => e);
    cutOff.stop(true);
    expect(err).toBeInstanceOf(DownloadError);
    expect(err.kind).toBe('network');
    expect(readFileSync(part).length).toBe(1000);
  });

  it('cannot reach a closed port', async () => {
    const dead = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
    const url = `http://127.0.0.1:${dead.port}/x`;
    dead.stop(true);
    const part = join(tempDir('dead'), 'a.part');
    await expect(fetchPart({ ...request(part), url }, ctl(), noProgress)).rejects.toMatchObject({ kind: 'network' });
  });

  it('cancel does not wait for a stalled server', async () => {
    mode = 'stall';
    const part = join(tempDir('stall'), 'a.part');
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    const started = performance.now();
    await expect(fetchPart(request(part), ctrl.signal, noProgress)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('downloadFile', () => {
  it('downloads into the folder, drops the temp files and reports progress', async () => {
    const root = tempDir('cmd');
    await writeDownloadMeta({ dir: 'book', json: '{}', create: true }, root);
    const path = await downloadFile({ id: 'x@1', url: `${base}/file`, dir: 'book', fileName: '001.mp3', expectedSize: BODY.length, kind: 'audio' }, root);
    expect(path).toBe(join(root, 'book', '001.mp3'));
    expect(readFileSync(path)).toEqual(Buffer.from(BODY));
    expect(readdirSync(join(root, 'book')).sort()).toEqual(['001.mp3', 'meta.json']);
  });

  it('stops at once when the folder is gone (the download was deleted)', async () => {
    const root = tempDir('gone');
    await expect(downloadFile({ id: 'x@2', url: `${base}/file`, dir: 'book', fileName: '001.mp3' }, root)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(requests).toEqual([]);
  });

  it('refuses names that would leave the folder', async () => {
    const root = tempDir('escape');
    await expect(downloadFile({ id: 'x@3', url: `${base}/file`, dir: '../out', fileName: 'a.mp3' }, root)).rejects.toMatchObject({ kind: 'io' });
    await expect(downloadFile({ id: 'x@4', url: `${base}/file`, dir: 'book', fileName: '../a.mp3' }, root)).rejects.toMatchObject({ kind: 'io' });
  });

  it('serializes its errors as plain data for the page', async () => {
    mode = 'status';
    status = 404;
    const root = tempDir('wire');
    await writeDownloadMeta({ dir: 'book', json: '{}', create: true }, root);
    const err = await downloadFile({ id: 'x@5', url: `${base}/file`, dir: 'book', fileName: 'a.mp3' }, root).catch((e) => e);
    expect(JSON.parse(JSON.stringify(err))).toEqual({ kind: 'http', message: 'The file is no longer on the server', status: 404 });
  });
});
