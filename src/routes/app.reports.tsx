import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { reportsQuery, type ReportSnapshot } from "@/data/reports";
import { formatMinutes } from "@/data/time";
import { formatCents } from "@/lib/utils-format";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports · Boared" }] }),
  component: ReportsPage,
});

function downloadCsv(filename: string, rows: object[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const body = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          let value = String((row as Record<string, unknown>)[header] ?? "");
          if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const { isAdmin, workspaceId } = useAuth();
  const report = useQuery(reportsQuery(workspaceId));

  if (!isAdmin) {
    return <PageHeader title="Reports" description="Reports are visible to workspace admins." />;
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="The last 12 weeks of tickets, time, SLAs and money."
        action={
          report.data ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv("consflow-velocity.csv", report.data.weeks)}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              Export velocity
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8">
        <QueryState query={report} errorTitle="Couldn't load reports">
          {(data) => <ReportBody data={data} />}
        </QueryState>
      </div>
    </>
  );
}

function ReportBody({ data }: { data: ReportSnapshot }) {
  return (
    <>
      <Card className="space-y-3 p-5">
        <h2 className="font-display text-xl">Ticket velocity</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.weeks}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} width={32} />
              <Tooltip />
              <Bar dataKey="opened" fill="var(--primary)" name="Opened" radius={[3, 3, 0, 0]} />
              <Bar
                dataKey="closed"
                fill="var(--muted-foreground)"
                name="Closed"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="SLA overdue" value={String(data.sla.breached)} />
        <Stat label="SLA due soon" value={String(data.sla.atRisk)} />
        <Stat label="SLA on track" value={String(data.sla.ok)} />
        <Stat label="No SLA" value={String(data.sla.none)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Average first reply{" "}
        {data.sla.avgFirstResponseHours == null ? "—" : `${data.sla.avgFirstResponseHours}h`}.
        Average resolution{" "}
        {data.sla.avgResolutionHours == null ? "—" : `${data.sla.avgResolutionHours}h`}.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">Workload</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadCsv("consflow-workload.csv", data.workload)}
            >
              CSV
            </Button>
          </div>
          {data.workload.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assignments or time in this window.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.workload.map((row) => (
                <li key={row.userId} className="flex items-center justify-between gap-3">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {row.openTickets} open · {formatMinutes(row.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">Time by project</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadCsv("consflow-time.csv", data.timeByProject)}
            >
              CSV
            </Button>
          </div>
          {data.timeByProject.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No finished time entries in this window.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.timeByProject.map((row) => (
                <li key={row.projectId} className="flex items-center justify-between gap-3">
                  <span className="truncate">{row.title}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatMinutes(row.billableMinutes)} billable / {formatMinutes(row.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="font-display text-xl">Billing</h2>
        {data.billing.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.billing.map((row) => (
              <div key={row.currency} className="space-y-1 text-sm">
                <div className="font-medium">{row.currency}</div>
                <div>Outstanding {formatCents(row.outstandingCents, row.currency)}</div>
                <div>Paid this month {formatCents(row.paidThisMonthCents, row.currency)}</div>
                <div className="text-muted-foreground">
                  Aging: current {formatCents(row.aging.current, row.currency)}, 1–30{" "}
                  {formatCents(row.aging.d30, row.currency)}, 31–60{" "}
                  {formatCents(row.aging.d60, row.currency)}, older{" "}
                  {formatCents(row.aging.older, row.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-3xl tabular-nums">{value}</div>
    </Card>
  );
}
