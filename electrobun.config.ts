import type { ElectrobunConfig } from 'electrobun';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Window options (size, title bar, traffic lights) live in src/bun/index.ts.
// Lectern renders with the bundled Chromium (CEF) on every platform, not the system webview.
export default {
  app: {
    name: 'Lectern',
    // Same identifier as the Tauri build: the app data folder (downloads) keeps its place.
    identifier: 'com.lectern.app',
    version,
    description: 'A desktop listening room for Audiobookshelf',
    // OpenID sign-in comes back to the app through these links (macOS; see src/bun/deeplink.ts for the rest).
    urlSchemes: ['audiobookshelf', 'lectern']
  },
  build: {
    mainProcess: 'bun',
    bun: {
      entrypoint: 'src/bun/index.ts'
    },
    // SvelteKit's static output (`vite build` writes dist/; `build/` is Electrobun's own output folder).
    copy: {
      dist: 'views/mainview',
      'assets/icons/tray-template.png': 'views/tray/tray-template.png',
      'assets/icons/icon.png': 'views/tray/icon.png'
    },
    watchIgnore: ['dist/**', 'node_modules/**'],
    mac: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      icons: 'assets/icons/icon.iconset'
    },
    win: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      icon: 'assets/icons/icon.ico'
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      icon: 'assets/icons/icon.png'
    }
  },
  runtime: {
    // Closing the window hides it (playback goes on from the menu bar); src/bun/index.ts decides when to quit.
    exitOnLastWindowClosed: false
  }
} satisfies ElectrobunConfig;
