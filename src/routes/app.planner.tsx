import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/planner")({
  head: () => ({ meta: [{ title: "AI Planner · Boared" }] }),
  component: () => <Outlet />,
});
