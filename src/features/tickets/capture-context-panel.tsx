import { useState } from "react";
import { ChevronDown, Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/app-shell";
import type { CaptureContext } from "@/data/types";

/**
 * The technical detail the client never had to think about.
 *
 * Collapsed by default because it is reference material, not the story — but
 * the console output is usually what actually identifies the bug, so it is one
 * click away rather than somewhere else entirely.
 */
export function CaptureContextPanel({ context }: { context: CaptureContext }) {
  const [open, setOpen] = useState(false);

  const consoleEntries = asArray<{ level?: string; message?: string; ts?: string }>(
    context.console_log,
  );
  const networkEntries = asArray<{ method?: string; url?: string; status?: number }>(
    context.network_errors,
  );
  const errorCount = consoleEntries.filter((e) => e.level === "error").length;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-accent/40"
      >
        <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">Technical details</span>
        {(errorCount > 0 || networkEntries.length > 0) && (
          <StatusPill tone="warning">
            {[
              errorCount > 0 ? `${errorCount} console errors` : "",
              networkEntries.length > 0 ? `${networkEntries.length} failed requests` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </StatusPill>
        )}
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-3 text-sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <Detail label="Page" value={context.url} mono />
            <Detail label="Page title" value={context.page_title} />
            <Detail
              label="Browser"
              value={[context.browser, context.browser_version].filter(Boolean).join(" ")}
            />
            <Detail label="Operating system" value={context.os} />
            <Detail
              label="Window"
              value={
                context.viewport_w && context.viewport_h
                  ? `${context.viewport_w} × ${context.viewport_h}${context.dpr ? ` at ${context.dpr}×` : ""}`
                  : null
              }
            />
            <Detail label="Device" value={context.device_type} />
            <Detail label="Timezone" value={context.timezone} />
            <Detail label="Language" value={context.locale} />
            <Detail
              label="Online"
              value={context.online === false ? "No — they were offline" : null}
            />
            <Detail label="Came from" value={context.referrer} mono />
            <Detail label="App version" value={context.app_version} mono />
          </dl>

          {networkEntries.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Requests that failed
              </h4>
              <ul className="space-y-0.5 font-mono text-xs">
                {networkEntries.map((entry, index) => (
                  <li key={index} className="flex gap-2">
                    <span
                      className={
                        entry.status === 0 || (entry.status ?? 0) >= 500
                          ? "text-destructive"
                          : "text-warning"
                      }
                    >
                      {entry.status === 0 ? "ERR" : entry.status}
                    </span>
                    <span className="text-muted-foreground">{entry.method}</span>
                    <span className="min-w-0 truncate">{entry.url}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {consoleEntries.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Console, just before they reported it
              </h4>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded bg-muted/50 p-2 font-mono text-xs">
                {consoleEntries.map((entry, index) => (
                  <li
                    key={index}
                    className={
                      entry.level === "error" ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono text-xs" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

/** jsonb comes back as Json; narrow before rendering rather than casting. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
