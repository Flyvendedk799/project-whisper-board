import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import type { AvatarPerson } from "@/components/person-avatar";
import { ownProfileQuery } from "@/data/projects";

/**
 * The signed-in person as an avatar sees them: their profile once it has
 * loaded, the sign-in metadata until then.
 */
export function useOwnPerson(): AvatarPerson | null {
  const { user } = useAuth();
  const profile = useQuery(ownProfileQuery(user?.id)).data;
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    id: user.id,
    full_name: profile?.full_name ?? text(meta.full_name) ?? text(meta.name),
    email: profile?.email ?? user.email ?? null,
    avatar_url: profile ? profile.avatar_url : (text(meta.avatar_url) ?? text(meta.picture)),
  };
}
