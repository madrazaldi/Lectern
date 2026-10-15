import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const FORWARDED = ["authorization", "content-type", "x-refresh-token", "x-return-tokens"];

/**
 * Dev-only relay so the UI can also be opened in an ordinary browser tab, where
 * Audiobookshelf's CORS handling would otherwise block API calls. Tauri builds use
 * the native HTTP plugin and never touch this.
 */
/** @returns {import("vite").Plugin} */
function absDevProxy() {
  return {
    name: "abs-dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__abs_proxy", async (req, res) => {
        try {
          const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url");
          if (!target || !/^https?:\/\//.test(target)) {
            res.statusCode = 400;
            return res.end("Missing url");
          }
          /** @type {Record<string, string>} */
          const headers = {};
          for (const h of FORWARDED) if (req.headers[h]) headers[h] = String(req.headers[h]);
          /** @type {Buffer[]} */
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const upstream = await fetch(target, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          res.statusCode = upstream.status;
          const type = upstream.headers.get("content-type");
          if (type) res.setHeader("content-type", type);
          res.end(new Uint8Array(await upstream.arrayBuffer()));
        } catch (err) {
          res.statusCode = 502;
          res.end(String(err));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [sveltekit(), absDevProxy()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: { include: ["src/**/*.test.ts"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
