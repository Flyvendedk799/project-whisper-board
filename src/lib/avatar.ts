/**
 * Profile photos: what may be uploaded and where it lives.
 *
 * The `avatars` bucket is public and each person may only write under their
 * own id (`<user id>/…`). The limits here mirror the bucket's, so a file is
 * turned away before it is sent rather than after.
 */

export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const AVATAR_ACCEPT = Object.keys(AVATAR_EXTENSIONS).join(",");

/** Why a file can't be a profile photo, or null when it can. */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_EXTENSIONS[file.type]) return "Choose a PNG, JPEG, WebP or GIF image.";
  if (file.size > AVATAR_MAX_BYTES) return "That image is over 2 MB. Choose a smaller one.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** A fresh object path in the person's own folder, so a new photo never hits a stale cache. */
export function avatarObjectPath(userId: string, type: string, now = Date.now()): string {
  return `${userId}/avatar-${now}.${AVATAR_EXTENSIONS[type] ?? "img"}`;
}

const PUBLIC_PREFIX = `/storage/v1/object/public/${AVATAR_BUCKET}/`;

/**
 * The object behind a photo URL, when it is one this person uploaded. A
 * provider photo (Google etc.) or someone else's file is never ours to delete.
 */
export function ownAvatarObject(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const at = pathname.indexOf(PUBLIC_PREFIX);
  if (at === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(at + PUBLIC_PREFIX.length));
  } catch {
    return null;
  }
  const [folder, ...rest] = path.split("/");
  if (folder !== userId || rest.length === 0 || rest.some((part) => !part || part === "..")) {
    return null;
  }
  return path;
}
