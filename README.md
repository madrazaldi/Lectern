# Lectern

A desktop listening room for [Audiobookshelf](https://www.audiobookshelf.org). Built with Tauri 2, SvelteKit (Svelte 5) and TypeScript.

## Features

- Browse books, series, authors, collections and playlists; filter by genre, author, narrator, series, tag, language or publisher; grid or list view (virtualized, so large libraries stay fast).
- Chapter-aware player with gapless multi-file playback, sleep timer (minutes or end of chapter), smart rewind, bookmarks, and per-title speed.
- **Up Next** queue, with optional auto-continue to the next book in a series or the next podcast episode.
- **Offline downloads**: play downloaded titles with no connection; listening is recorded locally and synced when the server is back.
- **Progress you can't lose**: the position is written ahead to disk between syncs and replayed after a crash or force-quit, but never over newer progress from another device. Pausing here and listening on your phone, then pressing play here, picks up where the phone left off.
- **Live sync** over Audiobookshelf's socket.io feed: progress from other devices and library changes appear as they happen.
- Native integration: menu bar (tray) controls, a full macOS menu bar with shortcuts, closing the window keeps playback going (quit with ⌘Q), single instance, system Now Playing / media keys via the Media Session API.
- Multiple accounts and servers; credentials live in the OS keychain.

## Development

Requires [Bun](https://bun.sh) and a Rust toolchain ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
bun install
bun run tauri dev      # desktop app with hot reload
bun run dev            # UI only, in a browser (API calls go through a dev-server relay; no downloads/keychain)
```

Checks:

```sh
bun run check          # svelte-check (types)
bun run lint           # eslint + prettier --check
bun run test           # vitest
cd src-tauri && cargo clippy
```

Release build: `bun run tauri build`.

## Layout

| Path                                 | What lives there                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api`                        | Audiobookshelf HTTP client (requests go through Tauri's native HTTP plugin; the server's CORS handling blocks the webview), accounts, types |
| `src/lib/stores/player.svelte.ts`    | Playback engine: sessions, sync, gapless tracks, offline sessions, Up Next                                                                  |
| `src/lib/stores/outbox.svelte.ts`    | Progress waiting to reach the server (write-ahead + offline sessions)                                                                       |
| `src/lib/stores/downloads.svelte.ts` | Offline downloads                                                                                                                           |
| `src/lib/stores/live.svelte.ts`      | socket.io live updates                                                                                                                      |
| `src/lib/native.ts`                  | Bridge to the Rust side, with browser fallbacks                                                                                             |
| `src-tauri/src`                      | Tray, menus, quit handshake, keychain, downloads                                                                                            |

### Quitting

Closing the window hides it. Quitting from the app menu, the tray or the keyboard asks the frontend to save the
position and close the server session (`app-quit-requested` → `quit_now`); Rust force-exits after 4 seconds if the
frontend never answers. Quits that can't be intercepted (e.g. the Dock's Quit) lose nothing beyond the last
5-second write-ahead, which is replayed on the next launch.
