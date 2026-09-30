import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader, EmptyState } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { TimeSheet } from "@/features/time/time-sheet";

export const Route = createFileRoute("/app/time")({
  validateSearch: z.object({
    /** Opens the Log time dialog, so the command palette can link straight to it. */
    log: z.boolean().optional(),
  }),
  head: () => ({ meta: [{ title: "Time · Boared" }] }),
  component: TimePage,
});

function TimePage() {
  const { isAdmin } = useAuth();
  const { log } = Route.useSearch();

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Time" />
        <div className="mx-auto max-w-[1120px] px-4 py-6 md:px-8">
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="Time tracking is for the agency"
              description="Your invoices show the time that has been billed."
            />
          </div>
        </div>
      </>
    );
  }

  return <TimeSheet page initialLogOpen={Boolean(log)} />;
}
