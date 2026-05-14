import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Workspace · ClientDesk" }] }),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
