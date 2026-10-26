/**
 * Electrobun main process.
 *
 * Owns the window (rendered by the bundled Chromium, CEF) and runs the whole backend in this process:
 *
 *   page --RPC invoke(cmd, args)--> dispatch() --> command handlers (commands.ts, shell.ts)
 *   page <--RPC "event" message---- emit() (events.ts)
 *   page --http--> 127.0.0.1:<random port>/<token>/file?path=…   (files.ts: downloaded audio and covers)
 */
import Electrobun, { BrowserView, BrowserWindow, Updater, type RPCSchema } from 'electrobun/main';
import { dispatch } from './commands';
import { setEventSink } from './events';
import { setLinkHandler } from './deeplink';
import { startFileServer } from './files';
import { downloadsRoot } from './paths';
import { attachWindow, handleLinks, initialPlacement, installMenus, isMac, openExternal, TRAFFIC_LIGHTS } from './shell';
import type { PushEvents, Reply } from '../shared/rpc';

type LecternRPC = {
  bun: RPCSchema<{
    requests: { invoke: { params: { cmd: string; args: Record<string, unknown> }; response: Reply } };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: { event: { event: keyof PushEvents; payload: unknown } };
  }>;
};

process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('uncaught exception:', e));

const DEV_SERVER = 'http://127.0.0.1:1420';

/** In development, use the Vite dev server (hot reload) when it is running; otherwise the built UI. */
async function pickUrl(): Promise<string> {
  if ((await Updater.localInfo.channel()) === 'dev' && !process.env.LECTERN_NO_DEV_SERVER) {
    try {
      await fetch(DEV_SERVER, { method: 'HEAD', signal: AbortSignal.timeout(800) });
      console.log(`Using the Vite dev server at ${DEV_SERVER}`);
      return DEV_SERVER;
    } catch {
      // Not running: use the bundled build.
    }
  }
  return 'views://mainview/index.html';
}

const files = startFileServer(downloadsRoot());

const rpc = BrowserView.defineRPC<LecternRPC>({
  // Downloads and sign-in outlive Electrobun's one-second default.
  maxRequestTime: Infinity,
  handlers: {
    requests: { invoke: ({ cmd, args }) => dispatch(cmd, args) },
    messages: {}
  }
});

const placement = initialPlacement();

const win = new BrowserWindow({
  title: 'Lectern',
  url: await pickUrl(),
  frame: placement.frame,
  renderer: 'cef',
  // macOS draws the traffic lights over the page; elsewhere the system title bar stays.
  titleBarStyle: isMac ? 'hiddenInset' : 'default',
  trafficLightOffset: TRAFFIC_LIGHTS,
  // Runs in the page before any other script.
  preload: `window.__lectern = ${JSON.stringify({ files: files.baseUrl, platform: process.platform, debug: !!process.env.LECTERN_DEBUG })};`,
  rpc
});

setEventSink((event, payload) => win.webview.rpc?.send.event({ event, payload }));
attachWindow(win, placement);
installMenus();

setLinkHandler((link) => handleLinks([link]));
// macOS hands the app the links of its registered schemes (see deeplink.ts for the other platforms).
Electrobun.events.on('open-url', (e: unknown) => {
  const url = (e as { data?: { url?: string } }).data?.url;
  if (url) handleLinks([url]);
});

// Electrobun cancels new windows (the `target="_blank"` links in book and author descriptions) and only reports them;
// send them to the browser.
Electrobun.events.on('new-window-open', (e: unknown) => {
  const detail = (e as { data?: { detail?: string | { url?: string } } }).data?.detail;
  const url = typeof detail === 'string' ? detail : detail?.url;
  if (!url) return;
  try {
    openExternal(url);
  } catch (err) {
    console.warn(`not opening ${url}: ${err}`);
  }
});

console.log('Lectern started');
