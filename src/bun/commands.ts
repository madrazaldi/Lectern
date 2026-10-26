// Commands the page can call (`invoke(cmd, args)` in src/lib/ipc.ts). Anything that needs the window or the menus is
// registered by shell.ts into the same table.
import {
  cancelDownload,
  downloadFile,
  downloadsFreeSpace,
  downloadsUsage,
  listDownloadMeta,
  pruneDownloads,
  removeDownload,
  writeDownloadMeta
} from './downloads';
import { httpAbort, httpFetch } from './http';
import { secretDelete, secretGet, secretSet } from './secrets';
import type { Reply } from '../shared/rpc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (args: any) => unknown | Promise<unknown>;

const handlers = new Map<string, Handler>();

export function register(table: Record<string, Handler>) {
  for (const [name, fn] of Object.entries(table)) handlers.set(name, fn);
}

register({
  secret_get: secretGet,
  secret_set: secretSet,
  secret_delete: secretDelete,
  download_file: downloadFile,
  cancel_download: (a: { id: string }) => cancelDownload(a.id),
  write_download_meta: writeDownloadMeta,
  list_download_meta: () => listDownloadMeta(),
  remove_download: removeDownload,
  downloads_usage: () => downloadsUsage(),
  downloads_free_space: () => downloadsFreeSpace(),
  prune_downloads: () => pruneDownloads(),
  http_fetch: httpFetch,
  http_abort: httpAbort
});

/** What the page receives for a failure: plain data, since only that survives the trip. */
export function toWire(err: unknown): unknown {
  if (err && typeof err === 'object' && 'toJSON' in err && typeof err.toJSON === 'function') return err.toJSON();
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
}

export async function dispatch(cmd: string, args: Record<string, unknown> = {}): Promise<Reply> {
  const fn = handlers.get(cmd);
  if (!fn) return { err: `unknown command: ${cmd}` };
  try {
    const value = await fn(args);
    return { ok: value === undefined ? null : value };
  } catch (err) {
    return { err: toWire(err) };
  }
}
