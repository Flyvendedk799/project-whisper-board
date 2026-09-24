import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { saveSlaPolicy } from "@/data/mutations";
import { DEFAULT_SLA_MINUTES, slaPoliciesQuery } from "@/data/sla";
import { qk } from "@/data/keys";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, type TicketPriority } from "@/data/enums";

type Draft = Record<TicketPriority, { firstHours: string; resolutionHours: string }>;

function hours(minutes: number) {
  return String(Math.round((minutes / 60) * 10) / 10);
}

function toMinutes(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 60);
}

export function SlaPoliciesCard() {
  const { workspaceId } = useAuth();
  const policies = useQuery(slaPoliciesQuery(workspaceId));
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!policies.data) return;
    const next = {} as Draft;
    for (const priority of TICKET_PRIORITIES) {
      const row = policies.data.find((policy) => policy.priority === priority);
      const fallback = DEFAULT_SLA_MINUTES[priority];
      next[priority] = {
        firstHours: hours(row?.first_response_minutes ?? fallback.first),
        resolutionHours: hours(row?.resolution_minutes ?? fallback.resolution),
      };
    }
    setDraft(next);
  }, [policies.data]);

  const save = useDataMutation("sla_policies.upsert", saveSlaPolicy, {
    invalidate: [qk.slaPolicies(workspaceId ?? undefined)],
  });

  const persist = async (priority: TicketPriority, values = draft?.[priority]) => {
    if (!workspaceId || !values) return;
    const first = toMinutes(values.firstHours);
    const resolution = toMinutes(values.resolutionHours);
    if (first == null || resolution == null) return;
    await save.run({
      workspaceId,
      priority,
      firstResponseMinutes: first,
      resolutionMinutes: resolution,
    });
  };

  return (
    <QueryState query={policies} errorTitle="Couldn't load SLA policies">
      {() => (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Response times</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Deadlines are applied when a ticket is opened or its priority changes. Hours, not
                minutes — a day is 24.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={save.busy}
              onClick={() => {
                void (async () => {
                  for (const priority of TICKET_PRIORITIES) {
                    const values = DEFAULT_SLA_MINUTES[priority];
                    await save.run({
                      workspaceId: workspaceId!,
                      priority,
                      firstResponseMinutes: values.first,
                      resolutionMinutes: values.resolution,
                    });
                  }
                })();
              }}
            >
              Use defaults
            </Button>
          </div>

          {draft && (
            <div className="space-y-3">
              {TICKET_PRIORITIES.map((priority) => (
                <form
                  key={priority}
                  className="grid gap-3 rounded-md border p-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void persist(priority);
                  }}
                >
                  <div className="text-sm font-medium">{TICKET_PRIORITY_LABEL[priority]}</div>
                  <div className="space-y-1">
                    <Label htmlFor={`sla-first-${priority}`}>First reply (hours)</Label>
                    <Input
                      id={`sla-first-${priority}`}
                      inputMode="decimal"
                      value={draft[priority].firstHours}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [priority]: { ...draft[priority], firstHours: event.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`sla-resolve-${priority}`}>Resolve (hours)</Label>
                    <Input
                      id={`sla-resolve-${priority}`}
                      inputMode="decimal"
                      value={draft[priority].resolutionHours}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [priority]: { ...draft[priority], resolutionHours: event.target.value },
                        })
                      }
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={save.busy}>
                    Save
                  </Button>
                </form>
              ))}
            </div>
          )}
        </Card>
      )}
    </QueryState>
  );
}
