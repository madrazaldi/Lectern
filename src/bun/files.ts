// Downloaded audio and covers reach the page through a small server on 127.0.0.1 (the page's own origin can't read
// files), the way Tauri's `asset:` protocol used to serve them:
//
//   http://127.0.0.1:<port>/<token>/file?path=<absolute path inside the downloads folder>
//
// The token is random per launch and handed to the page in its preload script, so other local programs and web pages
// can't read the files. Range requests work, which is how <audio> seeks.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-range, accept-ranges, content-length'
};

function fail(status: number, message: string) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain', ...CORS } });
}

/** Is `path` inside `root` (after resolving symlinks)? */
export async function insideRoot(root: string, path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null;
  try {
    const [real, base] = await Promise.all([realpath(resolve(path)), realpath(root)]);
    const rel = relative(base, real);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..') ? real : null;
  } catch {
    return null;
  }
}

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes: the inclusive range, or null if unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start >= size || start > end ? null : { start, end };
}

export async function serveFile(root: string, path: string, req: Request): Promise<Response> {
  const real = await insideRoot(root, path);
  if (!real) return fail(404, 'Not found');
  let size: number;
  try {
    const st = await stat(real);
    if (!st.isFile()) return fail(404, 'Not found');
    size = st.size;
  } catch {
    return fail(404, 'Not found');
  }
  const file = Bun.file(real);
  const headers: Record<string, string> = {
    'content-type': file.type.split(';')[0] || 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    ...CORS
  };
  const range = req.headers.get('range');
  if (range) {
    const r = parseRange(range, size);
    if (!r) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    return new Response(req.method === 'HEAD' ? null : file.slice(r.start, r.end + 1), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${r.start}-${r.end}/${size}`, 'content-length': String(r.end - r.start + 1) }
    });
  }
  return new Response(req.method === 'HEAD' ? null : file, { status: 200, headers: { ...headers, 'content-length': String(size) } });
}

export interface FileServer {
  /** `http://127.0.0.1:<port>/<token>`: what the page puts in front of `/file?path=…`. */
  baseUrl: string;
  stop(): void;
}

export function startFileServer(root: string): FileServer {
  const token = randomBytes(24).toString('base64url');
  const expected = Buffer.from(token);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed');
      const url = new URL(req.url);
      const [, given = '', route = ''] = url.pathname.split('/');
      const g = Buffer.from(given);
      if (g.length !== expected.length || !timingSafeEqual(g, expected)) return fail(403, 'Forbidden');
      if (route !== 'file') return fail(404, 'Not found');
      return serveFile(root, url.searchParams.get('path') ?? '', req);
    }
  });
  return { baseUrl: `http://127.0.0.1:${server.port}/${token}`, stop: () => void server.stop(true) };
}
