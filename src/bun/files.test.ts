import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insideRoot, parseRange, startFileServer, type FileServer } from './files';

const scratch = mkdtempSync(join(tmpdir(), 'lectern-files-test-'));
const root = join(scratch, 'downloads');
const outside = join(scratch, 'secret.txt');
const DATA = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
let server: FileServer;

beforeAll(() => {
  mkdirSync(join(root, 'book'), { recursive: true });
  writeFileSync(join(root, 'book', '001.mp3'), DATA);
  writeFileSync(join(root, 'book', 'cover.jpg'), 'jpg');
  writeFileSync(outside, 'top secret');
  symlinkSync(outside, join(root, 'book', 'link.txt'));
  server = startFileServer(root);
});
afterAll(() => {
  server.stop();
  rmSync(scratch, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit, base = server.baseUrl) => fetch(`${base}/file?path=${encodeURIComponent(path)}`, init);

describe('parseRange', () => {
  it('reads the forms a media element sends', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
  });
  it('rejects what cannot be satisfied', () => {
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=5-2', 1000)).toBeNull();
    expect(parseRange('bytes=-0', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});

describe('insideRoot', () => {
  it('accepts files in the folder and nothing else', async () => {
    expect(await insideRoot(root, join(root, 'book', '001.mp3'))).toBeTruthy();
    expect(await insideRoot(root, outside)).toBeNull();
    expect(await insideRoot(root, join(root, '..', 'secret.txt'))).toBeNull();
    expect(await insideRoot(root, join(root, 'book', 'link.txt'))).toBeNull();
    expect(await insideRoot(root, 'relative/path')).toBeNull();
    expect(await insideRoot(root, join(root, 'missing'))).toBeNull();
    expect(await insideRoot(root, root)).toBeNull();
  });
});

describe('file server', () => {
  it('serves a whole file with its type', async () => {
    const res = await get(join(root, 'book', '001.mp3'));
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA);
    expect((await get(join(root, 'book', 'cover.jpg'))).headers.get('content-type')).toBe('image/jpeg');
  });

  it('serves ranges, which is how audio seeks', async () => {
    const res = await get(join(root, 'book', '001.mp3'), { headers: { range: 'bytes=100-199' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(DATA.slice(100, 200));
    const tail = await get(join(root, 'book', '001.mp3'), { headers: { range: 'bytes=990-' } });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(DATA.slice(990));
    const bad = await get(join(root, 'book', '001.mp3'), { headers: { range: 'bytes=5000-' } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */1000');
  });

  it('will not leave the downloads folder', async () => {
    expect((await get(outside)).status).toBe(404);
    expect((await get(join(root, 'book', 'link.txt'))).status).toBe(404);
    expect((await get('/etc/hosts')).status).toBe(404);
  });

  it('wants the launch token', async () => {
    const wrong = server.baseUrl.replace(/[^/]+$/, 'not-the-token');
    expect((await get(join(root, 'book', '001.mp3'), undefined, wrong)).status).toBe(403);
    const noToken = server.baseUrl.replace(/\/[^/]+$/, '');
    expect((await get(join(root, 'book', '001.mp3'), undefined, noToken)).status).toBe(403);
  });

  it('only reads', async () => {
    const res = await get(join(root, 'book', '001.mp3'), { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
  });
});
