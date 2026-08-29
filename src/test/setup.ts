import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Keep tests deterministic: no real network, no leaked timers between cases.
vi.stubGlobal("fetch", vi.fn());

afterEach(() => {
  vi.clearAllMocks();
});
