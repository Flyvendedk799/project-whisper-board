/* eslint-disable react-refresh/only-export-components -- provider + hooks share this module */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/data/keys";
import { DataError } from "@/lib/errors";
import { getErrorTracker } from "@/lib/providers";
import type { AppRole } from "@/data/enums";
import type { WorkspaceSummary } from "@/lib/workspace.functions";

const ACTIVE_WS_KEY = "cf.activeWorkspaceId";

export interface AuthValue {
  session: Session | null;
  user: User | null;
  /** Memberships across all workspaces. */
  workspaces: WorkspaceSummary[];
  /** Active workspace id, or null if the user has none yet. */
  workspaceId: string | null;
  workspace: WorkspaceSummary | null;
  roles: AppRole[];
  isAdmin: boolean;
  isClientAdmin: boolean;
  /** 'error' means we could not determine the role — never assume 'client'. */
  rolesStatus: "pending" | "ready" | "error";
  loading: boolean;
  needsWorkspace: boolean;
  setActiveWorkspace: (id: string) => void;
  refetchWorkspaces: () => void;
  refetchRoles: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

function readStoredWorkspaceId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_WS_KEY);
  } catch {
    return null;
  }
}

function writeStoredWorkspaceId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
    else localStorage.removeItem(ACTIVE_WS_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    typeof window !== "undefined" ? readStoredWorkspaceId() : null,
  );

  useEffect(() => {
    let active = true;

    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      if (next?.access_token) supabase.realtime.setAuth(next.access_token);
      getErrorTracker().setUser(next?.user ? { id: next.user.id, email: next.user.email } : null);
      if (!next) {
        setActiveWorkspaceId(null);
        writeStoredWorkspaceId(null);
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      apply(next);
      if (event === "SIGNED_OUT") {
        queryClient.removeQueries({ queryKey: qk.all });
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void queryClient.invalidateQueries({ queryKey: qk.session() });
        void queryClient.invalidateQueries({ queryKey: qk.workspaces() });
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

  const workspacesQuery = useQuery({
    queryKey: qk.workspaces(),
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: 2,
    queryFn: async (): Promise<WorkspaceSummary[]> => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select(
          "role, workspace:workspaces(id, slug, name, logo_url, brand_color, support_email, website, invoice_prefix)",
        )
        .eq("user_id", userId!);
      if (error) throw new DataError("workspaces.list", error);

      const list: WorkspaceSummary[] = [];
      for (const row of data ?? []) {
        const raw = row.workspace as
          | Omit<WorkspaceSummary, "role">
          | Omit<WorkspaceSummary, "role">[]
          | null;
        const ws = Array.isArray(raw) ? raw[0] : raw;
        if (!ws) continue;
        list.push({ ...ws, role: row.role });
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    },
  });

  // Pick a valid active workspace once memberships load.
  useEffect(() => {
    const list = workspacesQuery.data;
    if (!list) return;
    if (list.length === 0) {
      if (activeWorkspaceId) {
        setActiveWorkspaceId(null);
        writeStoredWorkspaceId(null);
      }
      return;
    }
    const stillValid = activeWorkspaceId && list.some((w) => w.id === activeWorkspaceId);
    if (!stillValid) {
      const next = list[0]!.id;
      setActiveWorkspaceId(next);
      writeStoredWorkspaceId(next);
    }
  }, [workspacesQuery.data, activeWorkspaceId]);

  const setActiveWorkspace = useCallback(
    (id: string) => {
      setActiveWorkspaceId(id);
      writeStoredWorkspaceId(id);
      queryClient.removeQueries({
        predicate: (q) => {
          const key = q.queryKey;
          if (!Array.isArray(key) || key[0] !== "cf") return false;
          // Keep session + workspace list; drop domain data for the prior workspace.
          const second = key[1];
          return second !== "session" && second !== "workspaces";
        },
      });
    },
    [queryClient],
  );

  const workspace =
    workspacesQuery.data?.find((w) => w.id === activeWorkspaceId) ??
    workspacesQuery.data?.[0] ??
    null;
  const workspaceId = workspace?.id ?? null;

  const value = useMemo<AuthValue>(() => {
    const workspaces = workspacesQuery.data ?? [];
    const rolesStatus: AuthValue["rolesStatus"] = !userId
      ? "ready"
      : workspacesQuery.isError
        ? "error"
        : workspacesQuery.isSuccess
          ? "ready"
          : "pending";

    const role = workspace?.role;
    const roles: AppRole[] = role ? [role] : [];

    return {
      session,
      user: session?.user ?? null,
      workspaces,
      workspaceId,
      workspace,
      roles,
      isAdmin: rolesStatus === "ready" && role === "admin",
      isClientAdmin: rolesStatus === "ready" && role === "client_admin",
      rolesStatus,
      loading: loading || (Boolean(userId) && rolesStatus === "pending"),
      needsWorkspace: rolesStatus === "ready" && Boolean(userId) && workspaces.length === 0,
      setActiveWorkspace,
      refetchWorkspaces: () => void workspacesQuery.refetch(),
      refetchRoles: () => void workspacesQuery.refetch(),
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.removeQueries({ queryKey: qk.all });
      },
    };
  }, [
    session,
    userId,
    loading,
    workspacesQuery,
    workspace,
    workspaceId,
    setActiveWorkspace,
    queryClient,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function useUserId(): string | undefined {
  return useAuth().user?.id;
}

export function useWorkspaceId(): string {
  const { workspaceId } = useAuth();
  if (!workspaceId) throw new Error("No active workspace");
  return workspaceId;
}

export function useSignOut() {
  const { signOut } = useAuth();
  return useCallback(() => signOut(), [signOut]);
}
