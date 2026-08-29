import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/data/keys";
import { DataError } from "@/lib/errors";
import { getErrorTracker } from "@/lib/providers";
import type { AppRole } from "@/data/enums";

/**
 * Auth, mounted once.
 *
 * `useAuth` used to be a plain hook, so every page that called it — the shell,
 * the sidebar, the bell, the header and half a dozen routes — registered its
 * own onAuthStateChange listener and fired its own user_roles query. Eight of
 * each, per page load.
 *
 * The more serious problem was this, in the old hook:
 *
 *   const { data } = await supabase.from("user_roles")...
 *   setRoles((data ?? []).map(...))
 *
 * The error was dropped, so a failed role fetch produced an empty role list,
 * which made `isAdmin` false, which silently showed an admin the client portal.
 * Roles now come from a query with a real error state, and `rolesStatus` lets
 * the app refuse to render a role-dependent view it is not sure about.
 */

export interface AuthValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  isAdmin: boolean;
  isClientAdmin: boolean;
  /** 'error' means we could not determine the role — never assume 'client'. */
  rolesStatus: "pending" | "ready" | "error";
  loading: boolean;
  refetchRoles: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      // Realtime authorises the socket once, at connect. Without re-arming it
      // on refresh, postgres_changes subscriptions go quiet about an hour after
      // sign-in and never come back.
      if (next?.access_token) supabase.realtime.setAuth(next.access_token);
      getErrorTracker().setUser(next?.user ? { id: next.user.id, email: next.user.email } : null);
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      apply(next);
      if (event === "SIGNED_OUT") {
        // Another person may sign in on this device; none of the previous
        // one's data should still be sitting in the cache when they do.
        queryClient.removeQueries({ queryKey: qk.all });
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void queryClient.invalidateQueries({ queryKey: qk.session() });
      }
    });

    void supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user?.id;

  const rolesQuery = useQuery({
    queryKey: qk.session(),
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: 2,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!);
      if (error) throw new DataError("user_roles.list", error);
      return (data ?? []).map((row) => row.role);
    },
  });

  const value = useMemo<AuthValue>(() => {
    const roles = rolesQuery.data ?? [];
    const rolesStatus: AuthValue["rolesStatus"] = !userId
      ? "ready"
      : rolesQuery.isError
        ? "error"
        : rolesQuery.isSuccess
          ? "ready"
          : "pending";

    return {
      session,
      user: session?.user ?? null,
      roles,
      // Deliberately false while pending or errored: the caller checks
      // rolesStatus before drawing anything that depends on the answer.
      isAdmin: rolesStatus === "ready" && roles.includes("admin"),
      isClientAdmin: rolesStatus === "ready" && roles.includes("client_admin"),
      rolesStatus,
      loading: loading || (Boolean(userId) && rolesStatus === "pending"),
      refetchRoles: () => void rolesQuery.refetch(),
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.removeQueries({ queryKey: qk.all });
      },
    };
  }, [session, userId, loading, rolesQuery, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The signed-in user's id, for queries that cannot run without one. */
export function useUserId(): string | undefined {
  return useAuth().user?.id;
}

/** Stable no-op-safe callback for components that only need to sign out. */
export function useSignOut() {
  const { signOut } = useAuth();
  return useCallback(() => signOut(), [signOut]);
}
