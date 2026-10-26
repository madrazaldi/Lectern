# Lectern

A desktop listening room for [Audiobookshelf](https://www.audiobookshelf.org). Built with [Electrobun](https://electrobun.dev) (Bun on the desktop side, bundled Chromium for the window), SvelteKit (Svelte 5) and TypeScript.

## Features

- Browse books, series, authors, collections and playlists; filter by genre, author, narrator, series, tag, language or publisher; grid or list view (virtualized, so large libraries stay fast).
- Chapter-aware player with gapless multi-file playback, sleep timer (minutes, end of chapter or end of title), smart rewind, bookmarks, and per-title speed.
- **Mini player**: shrink the window to a small always-on-top player (⌘⇧M), and back to exactly where it was.
- **Ebook reader** for EPUB and PDF files in your library, with reading position synced to the server (shared with the Audiobookshelf web reader).
- **Podcast management**: search for or paste a feed to add a podcast, find and download episodes to the server, check for new episodes, and see the latest episodes across the library (for users allowed to manage the library).
- **Collections**: create and edit them, add titles from the right-click menu, and reorder by drag or keyboard; playlists reorder the same way.
- **Listening history** by day, a year in review, and library stats; "More in this series" and "More by this author" on every book.
- Right-click (or Shift+F10) menus on every title, a shortcut overview (press ?), and screen reader and keyboard support throughout.
- **Up Next** queue, with optional auto-continue to the next book in a series or the next podcast episode.
- **Offline downloads** that resume after an interruption and are checked for completeness: play downloaded titles with no connection; listening is recorded locally and synced when the server is back.
- **Progress you can't lose**: the position is written ahead to disk between syncs and replayed after a crash or force-quit, but never over newer progress from another device. Pausing here and listening on your phone, then pressing play here, picks up where the phone left off.
- **Live sync** over Audiobookshelf's socket.io feed: progress from other devices and library changes appear as they happen.
- Native integration: menu bar (tray) controls, a full macOS menu bar with shortcuts, closing the window keeps playback going (quit with ⌘Q), single instance, and system Now Playing via the Media Session API (see [Media keys](#media-keys)).
- Multiple accounts and servers; credentials live in the OS keychain.
- Sign in with a username and password, an API key, or **single sign-on** (OpenID Connect) through your browser, on servers that use it.

## Single sign-on (for server admins)

Lectern signs in with OpenID the way the Audiobookshelf mobile apps do: your browser handles the identity provider, then
sends the result back to Lectern through a link. Where that link goes depends on the platform.

- **macOS**: Lectern tries `audiobookshelf://oauth` first (allowed on every server by default), then `lectern://oauth`,
  then `http://127.0.0.1:47017/oauth` (see below). The system sends those links to the app once it has been run from an
  installed location (for example `/Applications`); a build run straight from a build folder may not be registered.
- **Windows and Linux**: Electrobun registers URL schemes on macOS only, so the custom links can't reach the app. Lectern
  listens on **`http://127.0.0.1:47017/oauth`** while a sign-in is waiting (and stops after six minutes or when it
  finishes). Your server has to allow that address, which is **not** allowed by default: add it under
  **Settings → Authentication → Allowed Mobile Redirect URIs**. Servers that already list it work with no other change.

If your server allows none of the addresses for the platform, Lectern says which one to add. At the identity provider, your
server's `/auth/openid/mobile-redirect` address must be an allowed redirect URI, as it is for the mobile apps.

## Media keys

Lectern publishes the title, position and play state through the browser Media Session API. Under the bundled Chromium
on macOS that reaches the system's Now Playing entry (the macOS media daemon shows Lectern as a player). Whether the
keyboard's play/pause/skip keys then control it hasn't been confirmed on real hardware; the menu bar, the tray and
the in-app shortcuts always work. On Windows and Linux the Media Session API is likewise handled by Chromium and
hasn't been tested there.

## Development

Requires [Bun](https://bun.sh). There is nothing else to install: Electrobun downloads its runtime and Chromium on
first use.

```sh
bun install
bun run app:dev        # desktop app: builds the UI, then runs it under Electrobun (Chromium debug port 9222)
bun run dev            # UI only, in a browser (API calls go through a dev-server relay; no downloads/keychain)
```

Checks:

```sh
bun run check          # svelte-check for the UI, tsc for src/bun
bun run lint           # eslint + prettier --check
bun run test           # vitest (UI) + bun test (src/bun)
bun run test:bun       # only the main-process tests
```

Release build: `bun run app:build` (output in `artifacts/`). A build bundles Chromium, so it is large (about 150 MB
unpacked).

Throwaway runs: `LECTERN_DATA_DIR=/tmp/lectern-data LECTERN_KEYCHAIN_SERVICE=com.lectern.app.dev bun run app:dev` keeps
downloads, window position and keychain entries away from your real ones.

## Layout

| Path                                 | What lives there                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api`                        | Audiobookshelf HTTP client (requests go through the main process; the server's CORS handling blocks the page), accounts, types           |
| `src/lib/stores/player.svelte.ts`    | Playback engine: sessions, sync, gapless tracks, offline sessions, Up Next                                                               |
| `src/lib/stores/outbox.svelte.ts`    | Progress waiting to reach the server (write-ahead + offline sessions)                                                                    |
| `src/lib/stores/downloads.svelte.ts` | Offline downloads                                                                                                                        |
| `src/lib/stores/live.svelte.ts`      | socket.io live updates                                                                                                                   |
| `src/lib/native.ts`                  | App features for the page (keychain, downloads, Now Playing...), with browser fallbacks                                                  |
| `src/lib/ipc.ts`                     | The page's side of the bridge to Bun: `invoke`, `listen`, `fetch`, window control                                                        |
| `src/shared`                         | Types and constants both sides use                                                                                                       |
| `src/bun`                            | Main process: window, menus, tray, quit handshake, keychain (`Bun.secrets`), downloads, native HTTP, local file server, sign-in redirect |
| `electrobun.config.ts`               | App identity, bundled Chromium, what gets copied into the bundle                                                                         |

### Quitting

Closing the window hides it. Quitting from the app menu, the tray or the keyboard asks the frontend to save the
position and close the server session (`app-quit-requested` → `quit_now`); the main process force-exits after 4 seconds if
the frontend never answers. Quits that can't be intercepted (e.g. the Dock's Quit) lose nothing beyond the last
5-second write-ahead, which is replayed on the next launch.

### Moving from the Tauri build

Downloads, the keychain entries (service `com.lectern.app`) and the window position are read from where the Tauri
build left them. Settings, the Up Next queue and unsent progress were stored by the old webview and are not carried
over; sign-ins and downloads are.
