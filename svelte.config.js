// The desktop shell has no Node.js server to do proper SSR, so we use adapter-static with a fallback to index.html
// to put the site in SPA mode. See: https://svelte.dev/docs/kit/single-page-apps
// The output goes to dist/ and electrobun.config.ts copies it into the app bundle (`build/` is Electrobun's own folder).
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
    }),
    // The old Tauri build's policy, minus its asset: and ipc: schemes. Scripts must come from the app itself (SvelteKit's
    // own inline bootstrap is allowed by hash). `http:`/`https:`/`ws:` are for the user's Audiobookshelf server, whose
    // address isn't known ahead of time, and for the app's own loopback servers.
    csp: process.argv.includes("dev")
      ? undefined
      : {
          mode: "hash",
          directives: {
            "default-src": ["self"],
            "script-src": ["self"],
            "style-src": ["self", "unsafe-inline", "blob:"],
            "img-src": ["self", "data:", "blob:", "http:", "https:"],
            "media-src": ["self", "blob:", "http:", "https:"],
            "connect-src": ["self", "http:", "https:", "ws:", "wss:"],
            "font-src": ["self", "data:", "blob:"],
          },
        },
    alias: {
      // The Electrobun webview SDK is projected into .hutch/devkit by `electrobun prepare`.
      "electrobun/view": resolve(".hutch/devkit/api/browser/index.ts"),
    },
  },
};

export default config;
