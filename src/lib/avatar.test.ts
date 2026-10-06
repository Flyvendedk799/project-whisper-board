import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, avatarFileProblem, avatarObjectPath, ownAvatarObject } from "./avatar";

const USER = "7d6f0c1e-1111-4a2b-8c3d-000000000001";
const BASE = "https://abc.supabase.co/storage/v1/object/public/avatars";

describe("avatarFileProblem", () => {
  it("accepts web images up to 2 MB", () => {
    expect(avatarFileProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(avatarFileProblem({ type: "image/webp", size: AVATAR_MAX_BYTES })).toBeNull();
  });

  it("turns away other types, big files and empty files", () => {
    expect(avatarFileProblem({ type: "image/svg+xml", size: 10 })).toMatch(/PNG, JPEG/);
    expect(avatarFileProblem({ type: "application/pdf", size: 10 })).toMatch(/PNG, JPEG/);
    expect(avatarFileProblem({ type: "image/jpeg", size: AVATAR_MAX_BYTES + 1 })).toMatch(/2 MB/);
    expect(avatarFileProblem({ type: "image/gif", size: 0 })).toMatch(/empty/);
  });
});

describe("avatarObjectPath", () => {
  it("puts the photo in the person's own folder with the right extension", () => {
    expect(avatarObjectPath(USER, "image/jpeg", 42)).toBe(`${USER}/avatar-42.jpg`);
    expect(avatarObjectPath(USER, "image/png", 42)).toBe(`${USER}/avatar-42.png`);
  });
});

describe("ownAvatarObject", () => {
  it("finds the object for a photo this person uploaded", () => {
    expect(ownAvatarObject(`${BASE}/${USER}/avatar-1.png`, USER)).toBe(`${USER}/avatar-1.png`);
    expect(ownAvatarObject(`${BASE}/${USER}/avatar%201.png?t=1`, USER)).toBe(
      `${USER}/avatar 1.png`,
    );
  });

  it("never claims a provider photo, someone else's file or a path escape", () => {
    expect(ownAvatarObject("https://lh3.googleusercontent.com/a/photo", USER)).toBeNull();
    expect(ownAvatarObject(`${BASE}/other-user/avatar-1.png`, USER)).toBeNull();
    expect(ownAvatarObject(`${BASE}/${USER}`, USER)).toBeNull();
    expect(ownAvatarObject(`${BASE}/${USER}/..%2Fother/x.png`, USER)).toBeNull();
    expect(ownAvatarObject("not a url", USER)).toBeNull();
    expect(ownAvatarObject(null, USER)).toBeNull();
  });
});
