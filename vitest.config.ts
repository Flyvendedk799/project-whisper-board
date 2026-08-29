import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const SHARED = {
  globals: true,
  setupFiles: ["./src/test/setup.ts"],
  passWithNoTests: true,
};

/**
 * Two projects rather than one: pure logic (error mapping, query builders,
 * the annotation model, the recorder state machine) runs in node with no DOM
 * cost, and anything rendering React gets happy-dom.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        test: {
          ...SHARED,
          name: "node",
          environment: "node",
          include: ["src/{lib,data}/**/*.{test,spec}.ts"],
        },
      },
      {
        test: {
          ...SHARED,
          name: "dom",
          environment: "happy-dom",
          include: ["src/{components,features,routes,hooks}/**/*.{test,spec}.{ts,tsx}"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/data/**", "src/features/**"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**"],
    },
  },
});
