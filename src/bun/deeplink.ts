// Links that bring a single sign-on back to the app (the server redirects the browser to one of them when the
// identity provider is done).
//
//  - macOS: Electrobun registers the URL schemes (`app.urlSchemes` in electrobun.config.ts) and reports a link as an
//    `open-url` event, handled in index.ts. The system learns the schemes when the app has been run from
//    /Applications (or anywhere LaunchServices has seen it).
//  - Windows and Linux: Electrobun can't register schemes (and a second copy of the app is turned away by Chromium's
//    own single-instance check before any of our code runs, so a link passed as an argument never arrives). The
//    fallback is a loopback redirect: the server sends the browser to `http://127.0.0.1:47017/oauth`, which this
//    process answers. The server's admin has to allow that address (see the README).
import { LOOPBACK_REDIRECT_URI } from '../shared/oauth';
import { register } from './commands';

export const SCHEMES = ['audiobookshelf', 'lectern'] as const;

/** Where the server sends the browser back to on Windows and Linux. Fixed, since the server only takes exact matches. */
export const LOOPBACK_PORT = Number(new URL(LOOPBACK_REDIRECT_URI).port);

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Lectern</title>
<body style="font:16px system-ui;background:#1b1922;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<p>You can close this tab and go back to Lectern.</p></body>`;

/** What happens to a link that comes back: index.ts brings the window forward and tells the page. */
let onLink: (link: string) => void = () => {};
export function setLinkHandler(fn: (link: string) => void) {
  onLink = fn;
}

let server: ReturnType<typeof Bun.serve> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

export function stopLoopback() {
  clearTimeout(idle);
  server?.stop(true);
  server = null;
}

/** Listen for the browser coming back. Stops by itself after `timeoutMs`, since a sign-in that never finishes shouldn't leave a port open. */
export function startLoopback(deliver: (link: string) => void, port = LOOPBACK_PORT, timeoutMs = 6 * 60_000) {
  stopLoopback();
  idle = setTimeout(stopLoopback, timeoutMs);
  server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.replace(/\/+$/, '') !== '/oauth' || req.method !== 'GET') return new Response('Not found', { status: 404 });
      // Same shape as the link a custom scheme would have carried.
      deliver(`http://127.0.0.1:${server?.port ?? port}/oauth${url.search}`);
      return new Response(DONE_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
  });
  return server.port;
}

register({
  // The page asks for this while it waits for a sign-in, and drops it afterwards.
  oauth_loopback_start: () => startLoopback((link) => onLink(link)),
  oauth_loopback_stop: () => stopLoopback()
});
