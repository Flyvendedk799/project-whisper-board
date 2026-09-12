// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * Packages that only ever run on the server, kept out of the browser build.
 *
 * They are reachable from the client module graph because the code that uses
 * them lives in server functions, which sit beside client code by design.
 * TanStack strips the handler bodies, but Rollup has already had to resolve and
 * parse the imports by then, and that is where this breaks:
 * `@flyvendedk799/ai-auth` imports `randomBytes` from `node:crypto` *by name*,
 * Vite rewrites `node:*` to a browser shim that exports no names, and the build
 * fails outright. `nodemailer` fails more quietly — it resolves, and ships an
 * SMTP client to every visitor as dead weight.
 *
 * Tree-shaking cannot fix either one: the failure happens at resolve time,
 * before anything is shaken. So the client build is given a stub instead. It is
 * never called — the only paths that reach these run on the server — and if that
 * ever stops being true, the stub says so rather than failing as a missing
 * export at build time or a silent no-op at runtime.
 *
 * `@flyvendedk799/ai-auth/registry` is deliberately NOT stubbed: the library
 * splits it out precisely so the model catalogue and error wording are safe in a
 * browser, and the AI provider imports it from there.
 */
const SERVER_ONLY_MODULES = ["nodemailer", "@flyvendedk799/ai-auth"];

/** Every binding the app imports from those packages. A new import lands here too. */
const STUBBED_EXPORTS = [
  "createTransport",
  "ClaudeAccountStore",
  "exchangeClaudeCode",
  "parsePastedCode",
  "sameState",
  "startClaudeLogin",
  "anthropicSubscriptionOptions",
  "withClaudeCodeIdentity",
];

function serverOnlyStubs(): Plugin {
  const PREFIX = "\0server-only-stub:";
  const source = [
    "const refuse = (name) => () => { throw new Error(`${name} is server-only and cannot run in the browser.`); };",
    ...STUBBED_EXPORTS.map((name) => `export const ${name} = refuse(${JSON.stringify(name)});`),
    `export default { ${STUBBED_EXPORTS.join(", ")} };`,
  ].join("\n");

  return {
    name: "server-only-stubs",
    enforce: "pre",
    resolveId(id) {
      // Only the browser build. The server build must have the real thing.
      if (this.environment?.name !== "client") return null;
      return SERVER_ONLY_MODULES.includes(id) ? PREFIX + id : null;
    },
    load(id) {
      return id.startsWith(PREFIX) ? source : null;
    },
  };
}

export default defineConfig({
  plugins: [serverOnlyStubs()],
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
