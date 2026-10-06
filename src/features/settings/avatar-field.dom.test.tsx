import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { AvatarField } from "./avatar-field";

const USER = "7d6f0c1e-1111-4a2b-8c3d-000000000001";
const OLD = `https://abc.supabase.co/storage/v1/object/public/avatars/${USER}/avatar-1.png`;
const NEW = `https://abc.supabase.co/storage/v1/object/public/avatars/${USER}/avatar-2.png`;

const mocks = vi.hoisted(() => ({
  person: { current: null as Record<string, string | null> | null },
  upload: vi.fn(),
  updateProfileAvatar: vi.fn(),
  removeStorageObject: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/use-own-person", () => ({ useOwnPerson: () => mocks.person.current }));
vi.mock("@/data/mutations", () => ({
  updateProfileAvatar: mocks.updateProfileAvatar,
  removeStorageObject: mocks.removeStorageObject,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: mocks.upload,
        getPublicUrl: () => ({ data: { publicUrl: NEW } }),
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const image = (size: number, type = "image/png") =>
  new File([new Uint8Array(size)], "me.png", { type });

beforeEach(() => {
  mocks.person.current = { id: USER, full_name: "Ada Lovelace", avatar_url: OLD };
  mocks.upload.mockResolvedValue({ error: null });
  mocks.updateProfileAvatar.mockResolvedValue({ error: null });
});
afterEach(cleanup);

describe("AvatarField", () => {
  it("uploads into the person's own folder, saves the URL and drops the old photo", async () => {
    renderWithQuery(<AvatarField />);
    await userEvent.upload(screen.getByLabelText("Profile photo"), image(1024));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Photo updated"));
    const [path, , options] = mocks.upload.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${USER}/avatar-\\d+\\.png$`));
    expect(options).toMatchObject({ contentType: "image/png", upsert: false });
    expect(mocks.updateProfileAvatar).toHaveBeenCalledWith({ id: USER, avatarUrl: NEW });
    expect(mocks.removeStorageObject).toHaveBeenCalledWith("avatars", [`${USER}/avatar-1.png`]);
  });

  it("turns away a file over 2 MB or of the wrong type before uploading", async () => {
    renderWithQuery(<AvatarField />);
    const input = screen.getByLabelText("Profile photo");
    await userEvent.upload(input, image(2 * 1024 * 1024 + 1));
    expect(mocks.toast.error).toHaveBeenLastCalledWith(expect.stringMatching(/2 MB/));
    await userEvent.upload(input, image(10, "image/svg+xml"), { applyAccept: false });
    expect(mocks.toast.error).toHaveBeenLastCalledWith(expect.stringMatching(/PNG, JPEG/));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes the uploaded file again when saving the profile fails", async () => {
    mocks.updateProfileAvatar.mockResolvedValue({ error: { message: "denied" } });
    renderWithQuery(<AvatarField />);
    await userEvent.upload(screen.getByLabelText("Profile photo"), image(1024));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    const [path] = mocks.upload.mock.calls[0]!;
    expect(mocks.removeStorageObject).toHaveBeenCalledWith("avatars", [path]);
    expect(mocks.removeStorageObject).not.toHaveBeenCalledWith("avatars", [`${USER}/avatar-1.png`]);
  });

  it("goes back to initials on Remove, and never deletes a provider photo", async () => {
    mocks.person.current = {
      id: USER,
      full_name: "Ada Lovelace",
      avatar_url: "https://lh3.googleusercontent.com/a/photo",
    };
    renderWithQuery(<AvatarField />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Photo removed"));
    expect(mocks.updateProfileAvatar).toHaveBeenCalledWith({ id: USER, avatarUrl: null });
    expect(mocks.removeStorageObject).not.toHaveBeenCalled();
  });

  it("offers no Remove without a photo", () => {
    mocks.person.current = { id: USER, full_name: "Ada Lovelace", avatar_url: null };
    renderWithQuery(<AvatarField />);
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
