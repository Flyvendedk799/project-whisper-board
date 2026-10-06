export function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (path.includes("://")) return false;
  if (path.includes("\\")) return false;
  try {
    const u = new URL(path, "https://boared.online");
    if (u.origin !== "https://boared.online") return false;
    if (u.username || u.password) return false;
    return u.pathname.startsWith("/");
  } catch {
    return false;
  }
}
