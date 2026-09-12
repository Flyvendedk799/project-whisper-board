// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Pin the deploy target. Left unset, Nitro defaults to `cloudflare-module` and
  // emits a Worker bundle plus wrangler config, which is not what runs here — the
  // app is served by `node .output/server/index.mjs` behind the host's tunnel.
  // Pinning it means a plain `npm run build` produces the artefact that actually
  // ships, instead of depending on NITRO_PRESET being set in the environment.
  nitro: { preset: "node-server" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
});
