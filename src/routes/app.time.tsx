import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { TimeSheet } from "@/features/time/time-sheet";

export const Route = createFileRoute("/app/time")({
  head: () => ({ meta: [{ title: "Time · Boared" }] }),
  component: TimePage,
});

function TimePage() {
  const { isAdmin } = useAuth();
  return (
    <>
      <PageHeader
        title="Time"
        description="Review the week, correct an entry, and mark what is billable."
      />
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        {isAdmin ? (
          <TimeSheet />
        ) : (
          <Card>
            <EmptyState
              icon={Clock}
              title="Time tracking is for the agency"
              description="Your invoices show the time that has been billed."
            />
          </Card>
        )}
      </div>
    </>
  );
}
