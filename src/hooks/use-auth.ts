/**
 * Kept so the ~8 existing call sites keep compiling. The implementation moved
 * to a context provider — see src/components/auth-provider.tsx for why.
 */
export { useAuth, useUserId, useSignOut, type AuthValue } from "@/components/auth-provider";
export type { AppRole } from "@/data/enums";
