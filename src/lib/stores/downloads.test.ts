// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioFile, LibraryItem } from '$lib/api/types';

vi.mock('$lib/native', () => ({ inTauri: true, call: vi.fn(), on: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('$lib/api/abs', () => ({ getItem: vi.fn() }));
vi.mock('$lib/api/client', () => ({
  getCredentials: vi.fn(),
  listAccounts: vi.fn(() => []),
  onAccountChanged: vi.fn(),
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  coverUrl: (id: string) => `http://abs/api/items/${id}/cover`,
  ensureFreshToken: vi.fn(() => Promise.resolve()),
  serverUrl: () => 'http://abs'
}));

const file = (index: number, duration: number, extra: Partial<AudioFile> = {}): AudioFile => ({
  index,
  ino: `ino${index}`,
  duration,
  bitRate: 64000,
  codec: 'mp3',
  mimeType: 'audio/mpeg',
  metadata: { filename: `Part ${index}.mp3`, ext: '.mp3', size: 1000 * index },
  ...extra
});

const item = (coverPath: string | null = null) =>
  ({
    id: 'book1',
    updatedAt: 1,
    mediaType: 'book',
    media: { metadata: { title: 'Ember', authorName: 'A. Writer' }, coverPath, audioFiles: [file(1, 100), file(2, 50)], chapters: [] }
  }) as unknown as LibraryItem;

const ACCOUNT = { id: 'acct-aaaa-1111', serverUrl: 'http://abs', username: 'root', method: 'password', accessToken: 't', refreshToken: null };
const DIR = 'acct-aaa-book1';

type Store = (typeof import('./downloads.svelte'))['downloads'];
interface Pending {
  id: string;
  args: Record<string, unknown>;
  resolve: (path: string) => void;
  reject: (err: unknown) => void;
}

let downloads: Store;
let planTracks: (typeof import('./downloads.svelte'))['planTracks'];
let call: ReturnType<typeof vi.fn>;
let getItem: ReturnType<typeof vi.fn>;
let log: [string, Record<string, unknown>][];
let disk: Record<string, string>;
let pending: Pending[];
/** How `download_file` answers; by default it finishes at once. */
let onDownload: (p: Pending) => void;
let free: number;

const cancelled = { kind: 'cancelled', message: 'cancelled' };
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await settle();
  expect(cond()).toBe(true);
}
const calls = (cmd: string) => log.filter(([c]) => c === cmd).map(([, a]) => a);

beforeEach(async () => {
  vi.resetModules();
  const native = await import('$lib/native');
  const abs = await import('$lib/api/abs');
  const client = await import('$lib/api/client');
  call = vi.mocked(native.call) as unknown as ReturnType<typeof vi.fn>;
  getItem = vi.mocked(abs.getItem) as unknown as ReturnType<typeof vi.fn>;
  vi.mocked(client.getCredentials).mockReturnValue(ACCOUNT as never);
  getItem.mockResolvedValue(item());
  log = [];
  disk = {};
  pending = [];
  free = 1e12;
  onDownload = (p) => p.resolve(`/data/${p.args.dir}/${p.args.fileName}`);
  call.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    log.push([cmd, args]);
    switch (cmd) {
      case 'download_file':
        return new Promise((resolve, reject) => {
          const p = { id: args.id as string, args, resolve, reject };
          pending.push(p);
          onDownload(p);
        });
      case 'cancel_download':
        for (const p of pending.filter((x) => x.id === args.id)) p.reject(cancelled);
        return;
      case 'write_download_meta': {
        const dir = args.dir as string;
        if (!(dir in disk) && !args.create) return false;
        disk[dir] = args.json as string;
        return true;
      }
      case 'list_download_meta':
        return Object.values(disk);
      case 'remove_download':
        delete disk[args.dir as string];
        return;
      case 'downloads_free_space':
        return free;
      default:
        return 0;
    }
  });
  ({ downloads, planTracks } = await import('./downloads.svelte'));
  downloads.retryDelays = [0, 0, 0];
  await downloads.load();
});

describe('planTracks', () => {
  it('lays files end to end in index order and skips excluded ones', () => {
    const tracks = planTracks([file(2, 50), file(1, 100), file(3, 25, { exclude: true }), file(4, 10)]);
    expect(tracks.map((t) => [t.startOffset, t.duration])).toEqual([
      [0, 100],
      [100, 50],
      [150, 10]
    ]);
    expect(tracks.map((t) => t.fileName)).toEqual(['001-ino1.mp3', '002-ino2.mp3', '003-ino4.mp3']);
  });

  it('never lets a server file name or extension escape the download folder', () => {
    const [t] = planTracks([file(1, 1, { ino: '../../etc', metadata: { filename: 'x', ext: '/../../evil', size: 1 } })]);
    expect(t.fileName).toBe('001-______etc');
  });
});

describe('downloads', () => {
  it('downloads every track, checks sizes, and marks the title ready', async () => {
    await downloads.start('book1');
    const r = downloads.ready('book1');
    expect(r?.tracks.map((t) => t.path)).toEqual([`/data/${DIR}/001-ino1.mp3`, `/data/${DIR}/002-ino2.mp3`]);
    expect(calls('download_file').map((a) => [a.fileName, a.expectedSize, a.kind])).toEqual([
      ['001-ino1.mp3', 1000, 'audio'],
      ['002-ino2.mp3', 2000, 'audio']
    ]);
    expect(JSON.parse(disk[DIR]).status).toBe('ready');
    expect(downloads.active).toBe(0);
  });

  it('starts only once when clicked twice', async () => {
    const a = downloads.start('book1');
    const b = downloads.start('book1');
    expect(downloads.active).toBe(1);
    await Promise.all([a, b]);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(calls('download_file')).toHaveLength(2);
  });

  it('ignores a cancelled run once a new one has started', async () => {
    onDownload = () => {};
    const first = downloads.start('book1');
    await until(() => pending.length === 1);
    const oldId = pending[0].id;

    const removing = downloads.cancel('book1');
    onDownload = (p) => p.resolve(`/data/${p.args.dir}/${p.args.fileName}`);
    const second = downloads.start('book1');
    await Promise.all([first, removing, second]);

    expect(calls('cancel_download').map((a) => a.id)).toEqual([oldId]);
    const ids = calls('download_file').map((a) => a.id as string);
    // The old run never went on to track 2; the new one used its own attempt ids.
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.filter((id) => id.startsWith('book1#2'))).toHaveLength(1);
    // The folder was deleted before the new run created it again.
    const order = log.map(([c, a]) => (c === 'write_download_meta' && a.create ? 'create' : c));
    expect(order.indexOf('remove_download')).toBeLessThan(order.lastIndexOf('create'));
    expect(downloads.ready('book1')).toBeTruthy();
  });

  it('cancels the cover download too', async () => {
    getItem.mockResolvedValue(item('/covers/book1.jpg'));
    onDownload = () => {};
    const run = downloads.start('book1');
    await until(() => pending.length === 1);
    expect(pending[0].args.kind).toBe('image');

    await downloads.cancel('book1');
    await run;
    expect(calls('cancel_download').map((a) => a.id)).toEqual([pending[0].id]);
    expect(calls('download_file')).toHaveLength(1);
    expect(disk[DIR]).toBeUndefined();
  });

  it('waits for the running file to stop before deleting the folder', async () => {
    onDownload = () => {};
    const run = downloads.start('book1');
    await until(() => pending.length === 1);
    let release!: () => void;
    // Rust's cancel resolves only once the attempt has closed its file.
    call.mockImplementationOnce(async (cmd: string, args: Record<string, unknown>) => {
      log.push([cmd, args]);
      await new Promise<void>((r) => (release = r));
      pending[0].reject(cancelled);
    });
    const removing = downloads.remove('book1');
    await settle();
    expect(calls('remove_download')).toHaveLength(0);
    release();
    await Promise.all([run, removing]);
    expect(calls('remove_download')).toEqual([{ dir: DIR }]);
  });

  it('does not bring a deleted download back with a late meta write', async () => {
    await downloads.start('book1');
    await downloads.remove('book1');
    const writes = calls('write_download_meta');
    expect(writes.filter((a) => a.create)).toHaveLength(1);
    expect(disk[DIR]).toBeUndefined();
  });

  it('pauses and resumes, keeping finished files', async () => {
    onDownload = (p) => {
      if (String(p.args.fileName).startsWith('001')) p.resolve(`/data/${DIR}/001-ino1.mp3`);
    };
    const run = downloads.start('book1');
    await until(() => pending.length === 2);
    await downloads.pause('book1');
    await run;
    const r = downloads.get('book1')!;
    expect(r.status).toBe('paused');
    expect(r.tracks.map((t) => !!t.path)).toEqual([true, false]);
    expect(r.bytesDone).toBe(1000);

    onDownload = (p) => p.resolve(`/data/${DIR}/${p.args.fileName}`);
    await downloads.start('book1');
    expect(
      calls('download_file')
        .slice(2)
        .map((a) => a.fileName)
    ).toEqual(['002-ino2.mp3']);
    expect(downloads.ready('book1')).toBeTruthy();
  });

  it('retries transient failures and then fails with a clear message', async () => {
    let failures = 1;
    onDownload = (p) => (failures-- > 0 ? p.reject({ kind: 'network', message: 'The connection timed out' }) : p.resolve(`/data/${DIR}/${p.args.fileName}`));
    await downloads.start('book1');
    expect(downloads.ready('book1')).toBeTruthy();
    const ids = calls('download_file').map((a) => a.id);
    expect(ids[0]).not.toBe(ids[1]);

    onDownload = (p) => p.reject({ kind: 'invalid', message: 'The server sent text/html instead of the file' });
    await downloads.remove('book1');
    await downloads.start('book1');
    const r = downloads.get('book1')!;
    expect(r.status).toBe('failed');
    expect(r.error).toBe('The server sent text/html instead of the file');
  });

  it('refuses to start without enough disk space', async () => {
    free = 500;
    await downloads.start('book1');
    expect(calls('download_file')).toHaveLength(0);
    expect(downloads.get('book1')).toBeUndefined();
    const { toasts } = await import('./toast.svelte');
    expect(toasts.at(-1)?.message).toContain('Not enough disk space: needs 2.9 KB, 500 B free.');
  });

  it('loads once, and reloads on request', async () => {
    expect(downloads.load()).toBe(downloads.load());
    await downloads.load();
    expect(calls('list_download_meta')).toHaveLength(1);
    expect(calls('prune_downloads')).toHaveLength(1);
    await downloads.reload();
    expect(calls('list_download_meta')).toHaveLength(2);
    expect(calls('prune_downloads')).toHaveLength(1);
  });

  it('lists downloads from other accounts separately and resumes interrupted ones as paused', async () => {
    const rec = (accountId: string, dir: string, status: string, accountLabel?: string) =>
      JSON.stringify({ key: 'book1', accountId, accountLabel, dir, itemId: 'book1', status, tracks: [], addedAt: 1, bytesTotal: 10, bytesDone: 5 });
    disk = {
      mine: rec(ACCOUNT.id, 'mine', 'downloading'),
      theirs: rec('other-account', 'theirs', 'ready', 'listener on abs'),
      gone: rec('deleted-account', 'gone', 'ready')
    };
    await downloads.reload();
    expect(downloads.list.map((r) => [r.dir, r.status])).toEqual([['mine', 'paused']]);
    expect(downloads.others.map((r) => r.dir).sort()).toEqual(['gone', 'theirs']);
    expect(downloads.others.map((r) => downloads.accountLabel(r)).sort()).toEqual(['A signed-out account', 'listener on abs']);

    await downloads.remove(downloads.others.find((r) => r.dir === 'gone')!);
    expect(calls('remove_download')).toEqual([{ dir: 'gone' }]);
    expect(downloads.others.map((r) => r.dir)).toEqual(['theirs']);
  });
});
