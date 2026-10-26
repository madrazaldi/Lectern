// The page's server requests, made here. Audiobookshelf answers CORS preflights with 401, so the page's own `fetch`
// can't reach most servers; Bun has no such restriction. src/lib/ipc.ts turns `fetch(...)` calls into `http_fetch`
// commands (and aborts into `http_abort`).
import tls from 'node:tls';
import type { HttpRequest, HttpResponse } from '../shared/rpc';

const inflight = new Map<string, AbortController>();

// Servers behind a private CA that the OS trusts should work too: add the system's roots to the bundled ones.
let trusted: string[] | undefined;
function trustedRoots(): string[] {
  if (trusted) return trusted;
  try {
    const system = tls.getCACertificates('system');
    trusted = system.length ? [...new Set([...tls.getCACertificates('bundled'), ...system])] : [];
  } catch {
    trusted = [];
  }
  return trusted;
}

/** `fetch` options that trust the system's roots as well; downloads use them too. */
export function tlsOptions(): { tls?: { ca: string[] } } {
  const roots = trustedRoots();
  return roots.length ? { tls: { ca: roots } } : {};
}

/** Headers that describe the wire encoding, not the body the page receives. */
const WIRE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: string }).code;
  // The page recognises certificate problems by their wording.
  return code && !err.message.includes(code) ? `${code}: ${err.message}` : err.message;
}

export async function httpFetch(req: HttpRequest): Promise<HttpResponse> {
  const ctrl = new AbortController();
  inflight.set(req.id, ctrl);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : Buffer.from(req.body, 'base64'),
      redirect: req.redirect ?? 'follow',
      signal: ctrl.signal,
      ...tlsOptions()
    });
    const body = Buffer.from(await res.arrayBuffer()).toString('base64');
    const headers: [string, string][] = [];
    res.headers.forEach((value, name) => {
      if (name === 'set-cookie' || WIRE_HEADERS.has(name)) return;
      headers.push([name, value]);
    });
    for (const cookie of res.headers.getSetCookie()) headers.push(['set-cookie', cookie]);
    return { status: res.status, statusText: res.statusText, headers, body, url: res.url };
  } catch (err) {
    throw describeError(err);
  } finally {
    inflight.delete(req.id);
  }
}

export function httpAbort(args: { id: string }) {
  inflight.get(args.id)?.abort();
}
