import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import {
  billingCsvRows,
  isoWeekNumber,
  reportsQuery,
  rowsToCsv,
  type ReportSnapshot,
} from "@/data/reports";
import { formatMinutes } from "@/data/time";
import { formatCents, formatDate } from "@/lib/utils-format";
import { ProjectChangeReport } from "@/features/reports/project-change-report";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports · Boared" }] }),
  component: ReportsPage,
});

function downloadCsv(filename: string, rows: object[]) {
  if (rows.length === 0) return;
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
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
    return (
      <>
        <PageHeader title="Reports" description="Reports are visible to workspace admins." />
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="Admins only"
              description="Ask a workspace admin if you need these numbers."
            />
          </div>
        </div>
      </>
    );
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
              onClick={() => downloadCsv("boared-velocity.csv", report.data.weeks)}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              Export velocity
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-7">
        <ProjectChangeReport workspaceId={workspaceId} />
        <QueryState query={report} errorTitle="Couldn't load reports">
          {(data) => <ReportBody data={data} />}
        </QueryState>
      </div>
    </>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-[22px] leading-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ReportBody({ data }: { data: ReportSnapshot }) {
  const weeks = data.weeks.map((row) => ({ ...row, label: `W${isoWeekNumber(row.week)}` }));
  const hoursLabel = (hours: number | null) => (hours == null ? "—" : `${hours}h`);

  return (
    <>
      <section className="rounded-[14px] border bg-card px-[22px] py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[22px] leading-tight">Ticket velocity</h2>
          <span className="flex gap-3.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-[9px] w-[9px] rounded-[2px] bg-primary" aria-hidden />
              Opened
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[9px] w-[9px] rounded-[2px] bg-muted-foreground/50" aria-hidden />
              Closed
            </span>
          </span>
        </div>
        <div className="h-64" role="img" aria-label="Tickets opened and closed per week">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} barGap={3}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={32}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                labelFormatter={(_, payload) =>
                  payload?.[0]?.payload?.week
                    ? `Week of ${formatDate(payload[0].payload.week)}`
                    : ""
                }
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="opened" fill="var(--primary)" name="Opened" radius={[3, 3, 0, 0]} />
              <Bar
                dataKey="closed"
                fill="var(--muted-foreground)"
                fillOpacity={0.5}
                name="Closed"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="SLA overdue" value={data.sla.breached} tone="destructive" />
        <Tile label="SLA due soon" value={data.sla.atRisk} tone="warning" />
        <Tile label="SLA on track" value={data.sla.ok} />
        <Tile label="No SLA" value={data.sla.none} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        Average first reply {hoursLabel(data.sla.avgFirstResponseHours)}. Average resolution{" "}
        {hoursLabel(data.sla.avgResolutionHours)}.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Workload"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={data.workload.length === 0}
              onClick={() => downloadCsv("boared-workload.csv", data.workload)}
            >
              CSV
            </Button>
          }
        >
          <DataTable
            empty="No assignments or time in this window."
            head={["Person", "Open tickets", "Logged"]}
            rows={data.workload.map((row) => ({
              key: row.userId,
              cells: [row.name, String(row.openTickets), formatMinutes(row.minutes)],
            }))}
          />
        </Panel>

        <Panel
          title="Time by project"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={data.timeByProject.length === 0}
              onClick={() => downloadCsv("boared-time.csv", data.timeByProject)}
            >
              CSV
            </Button>
          }
        >
          <DataTable
            empty="No finished time entries in this window."
            head={["Project", "Billable", "Total"]}
            rows={data.timeByProject.map((row) => ({
              key: row.projectId,
              cells: [row.title, formatMinutes(row.billableMinutes), formatMinutes(row.minutes)],
            }))}
          />
        </Panel>
      </div>

      <Panel
        title="Billing"
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={data.billing.length === 0}
            onClick={() => downloadCsv("boared-billing.csv", billingCsvRows(data.billing))}
          >
            CSV
          </Button>
        }
      >
        {data.billing.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {data.billing.map((row) => (
              <BillingCurrency key={row.currency} row={row} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

function BillingCurrency({ row }: { row: ReportSnapshot["billing"][number] }) {
  const buckets = [
    { name: "Current", value: row.aging.current, fill: "var(--chart-2)" },
    { name: "1–30 days", value: row.aging.d30, fill: "var(--chart-4)" },
    { name: "31–60 days", value: row.aging.d60, fill: "var(--chart-1)" },
    { name: "Older", value: row.aging.older, fill: "var(--destructive)" },
  ];
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">{row.currency}</div>
      <div className="text-muted-foreground">
        Outstanding {formatCents(row.outstandingCents, row.currency)} · Paid this month{" "}
        {formatCents(row.paidThisMonthCents, row.currency)}
      </div>
      <div className="h-36" role="img" aria-label={`Outstanding ${row.currency} invoices by age`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              formatter={(value: number) => formatCents(value, row.currency)}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ display: "none" }} />
            <Bar dataKey="value" name="Outstanding" radius={[3, 3, 0, 0]}>
              {buckets.map((bucket) => (
                <Cell key={bucket.name} fill={bucket.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs text-muted-foreground">
        Aging: current {formatCents(row.aging.current, row.currency)} · 1–30 days{" "}
        {formatCents(row.aging.d30, row.currency)} · 31–60 days{" "}
        {formatCents(row.aging.d60, row.currency)} · older{" "}
        {formatCents(row.aging.older, row.currency)}
      </div>
    </div>
  );
}

function DataTable({
  head,
  rows,
  empty,
}: {
  head: [string, string, string];
  rows: Array<{ key: string; cells: [string, string, string] }>;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[3fr_1fr_1fr] gap-3 bg-surface px-4 py-2.5 text-xs text-muted-foreground">
        <span>{head[0]}</span>
        <span className="text-right">{head[1]}</span>
        <span className="text-right">{head[2]}</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[3fr_1fr_1fr] items-center gap-3 border-t px-4 py-2.5 text-sm"
        >
          <span className="truncate font-medium">{row.cells[0]}</span>
          <span className="text-right tabular-nums">{row.cells[1]}</span>
          <span className="text-right font-mono text-xs tabular-nums">{row.cells[2]}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "warning";
}) {
  const ink =
    value > 0 && tone === "destructive"
      ? "text-destructive"
      : value > 0 && tone === "warning"
        ? "text-warning"
        : "text-foreground";
  return (
    <div className="rounded-[14px] border bg-card px-[18px] py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-[40px] leading-[1.1] tabular-nums ${ink}`}>
        {value}
      </div>
    </div>
  );
}
