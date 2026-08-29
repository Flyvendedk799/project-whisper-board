import { describe, expect, it } from "vitest";
import { __testing } from "./notifications.functions";

const { isQuietHour } = __testing;

/**
 * Quiet hours are computed in the recipient's timezone. Getting this wrong is
 * quiet: nobody reports the email that arrived at 3am, they just stop trusting
 * the notifications.
 */
describe("isQuietHour", () => {
  const at = (iso: string) => new Date(iso);

  it("is off when no window is configured", () => {
    expect(isQuietHour("UTC", null, null, at("2026-03-09T03:00:00Z"))).toBe(false);
    expect(isQuietHour("UTC", 22, null, at("2026-03-09T03:00:00Z"))).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const quiet = (iso: string) => isQuietHour("UTC", 22, 7, at(iso));
    expect(quiet("2026-03-09T23:30:00Z")).toBe(true);
    expect(quiet("2026-03-09T03:00:00Z")).toBe(true);
    expect(quiet("2026-03-09T06:59:00Z")).toBe(true);
    expect(quiet("2026-03-09T07:00:00Z")).toBe(false);
    expect(quiet("2026-03-09T14:00:00Z")).toBe(false);
    expect(quiet("2026-03-09T21:59:00Z")).toBe(false);
  });

  it("handles a window inside a single day", () => {
    const quiet = (iso: string) => isQuietHour("UTC", 9, 17, at(iso));
    expect(quiet("2026-03-09T12:00:00Z")).toBe(true);
    expect(quiet("2026-03-09T08:00:00Z")).toBe(false);
    expect(quiet("2026-03-09T17:00:00Z")).toBe(false);
  });

  it("uses the recipient's timezone, not the server's", () => {
    // 03:00 UTC is 22:00 the previous day in New York — inside a 22→07 window.
    expect(isQuietHour("America/New_York", 22, 7, at("2026-03-09T03:00:00Z"))).toBe(true);
    // The same instant is 11:00 in Tokyo, which is not.
    expect(isQuietHour("Asia/Tokyo", 22, 7, at("2026-03-09T03:00:00Z"))).toBe(false);
  });

  it("treats a zero-length window as no window", () => {
    expect(isQuietHour("UTC", 9, 9, at("2026-03-09T09:00:00Z"))).toBe(false);
  });

  it("does not silence someone because their timezone is unrecognised", () => {
    expect(isQuietHour("Mars/Olympus_Mons", 22, 7, at("2026-03-09T03:00:00Z"))).toBe(false);
  });
});
