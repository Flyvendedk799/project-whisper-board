import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { useTheme, type Theme } from "@/components/theme-provider";
import { useDataMutation, useServerAction } from "@/lib/use-server-action";
import { saveNotificationPreferences } from "@/lib/notifications.functions";
import { AntigravityAccountCard, ClaudeAccountCard } from "@/features/settings/ai-accounts";
import { AiAutomationCard } from "@/features/settings/ai-automation-card";
import { getGitHubStatus } from "@/lib/github.functions";
import { GitHubAccountCard } from "@/features/settings/github-account";

import { getIntegrationStatus, listAppErrors, listOutbox } from "@/lib/admin-views.functions";
import { updateWorkspace } from "@/lib/workspace.functions";
import { ApiKeyManager } from "@/features/settings/api-key-manager";
import { SlaPoliciesCard } from "@/features/settings/sla-policies-card";
import { LabelsCard } from "@/features/settings/labels-card";
import { supabase } from "@/integrations/supabase/client";
import { notificationPreferencesQuery, channelEnabled } from "@/data/notifications";
import { qk } from "@/data/keys";
import { updateProfile } from "@/data/mutations";
import {
  NOTIFICATION_KIND_DESCRIPTION,
  NOTIFICATION_KIND_LABEL,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
} from "@/data/enums";
import { Constants } from "@/integrations/supabase/types";
import { formatRelative } from "@/lib/utils-format";
import { toast } from "sonner";

export const Route = createFileRoute("/app/settings")({
  validateSearch: z.object({
    tab: z
      .enum(["you", "notifications", "sla", "labels", "integrations", "api", "outbox", "errors"])
      .optional(),
  }),
  component: SettingsPage,
});

/** Presets from the design; any hex still works in the field. */
const BRAND_SWATCHES = ["#b4583a", "#3d6db5", "#2f8a64", "#7b4fb8"];

const KINDS = Constants.public.Enums.notification_kind;

const TABS = [
  "you",
  "notifications",
  "sla",
  "labels",
  "integrations",
  "api",
  "outbox",
  "errors",
] as const;
type SettingsTab = (typeof TABS)[number];

const TAB_LABEL: Record<SettingsTab, string> = {
  you: "You and workspace",
  notifications: "Notifications",
  sla: "SLA",
  labels: "Labels",
  integrations: "Integrations",
  api: "API keys",
  outbox: "Outbox",
  errors: "Errors",
};

function SettingsPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const adminOnly: SettingsTab[] = ["sla", "labels", "integrations", "api", "outbox", "errors"];
  const visible = TABS.filter((key) => isAdmin || !adminOnly.includes(key));
  const tab: SettingsTab = visible.includes(search.tab ?? "you") ? (search.tab ?? "you") : "you";

  return (
    <>
      <PageHeader
        title="Settings"
        maxWidth="max-w-3xl"
        tabs={visible.map((key) => ({
          id: key,
          label: TAB_LABEL[key],
          active: tab === key,
          onSelect: () =>
            void navigate({
              search: (prev: { tab?: SettingsTab }) => ({ ...prev, tab: key }),
              replace: true,
            }),
        }))}
      />
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-7">
        {tab === "you" && (
          <div className="space-y-6">
            <ProfileCard />
            {isAdmin && (
              <SectionBoundary label="workspace">
                <WorkspaceCard />
              </SectionBoundary>
            )}
            {!isAdmin && (
              <>
                <SectionBoundary label="github-account">
                  <GitHubAccountCard />
                </SectionBoundary>
                <SectionBoundary label="claude-account">
                  <ClaudeAccountCard />
                </SectionBoundary>
                <SectionBoundary label="antigravity-account">
                  <AntigravityAccountCard />
                </SectionBoundary>
                <SectionBoundary label="ai-automation">
                  <AiAutomationCard />
                </SectionBoundary>
              </>
            )}
            <AppearanceCard />
          </div>
        )}

        {tab === "notifications" && (
          <SectionBoundary label="notification-preferences">
            <NotificationsCard />
          </SectionBoundary>
        )}

        {isAdmin && tab === "sla" && (
          <SectionBoundary label="sla-policies">
            <SlaPoliciesCard />
          </SectionBoundary>
        )}
        {isAdmin && tab === "labels" && (
          <SectionBoundary label="labels">
            <LabelsCard />
          </SectionBoundary>
        )}
        {isAdmin && tab === "integrations" && (
          <div className="space-y-6">
            <SectionBoundary label="integrations">
              <IntegrationsCard />
            </SectionBoundary>
            <SectionBoundary label="github-account">
              <GitHubAccountCard />
            </SectionBoundary>
            <SectionBoundary label="claude-account">
              <ClaudeAccountCard />
            </SectionBoundary>
            <SectionBoundary label="antigravity-account">
              <AntigravityAccountCard />
            </SectionBoundary>
            <SectionBoundary label="ai-automation">
              <AiAutomationCard />
            </SectionBoundary>
          </div>
        )}
        {isAdmin && tab === "api" && (
          <SectionBoundary label="api-keys">
            <Card className="space-y-4 rounded-[14px] p-5">
              <h2 className="font-display text-[22px] leading-tight">API keys</h2>
              <ApiKeyManager kind="account" />
            </Card>
          </SectionBoundary>
        )}
        {isAdmin && tab === "outbox" && (
          <SectionBoundary label="outbox">
            <OutboxCard />
          </SectionBoundary>
        )}
        {isAdmin && tab === "errors" && (
          <SectionBoundary label="app-errors">
            <ErrorsCard />
          </SectionBoundary>
        )}
      </div>
    </>
  );
}

function ProfileCard() {
  const { user, roles, workspaceId } = useAuth();
  const [name, setName] = useState(user?.user_metadata?.full_name ?? "");

  const save = useDataMutation(
    "profiles.update",
    (input: { fullName: string }) => updateProfile({ id: user!.id, fullName: input.fullName }),
    { success: "Saved", invalidate: [qk.profiles(), qk.workspacePeople(workspaceId ?? undefined)] },
  );

  const [sending, setSending] = useState(false);

  const sendReset = async () => {
    if (!user?.email) return;
    setSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSending(false);
    if (error) toast.error("Couldn't send that. Try again in a moment.");
    else toast.success("Check your email for the link.");
  };

  return (
    <Card className="space-y-4 rounded-[14px] p-5">
      <h2 className="font-display text-[22px] leading-tight">Your details</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.fire({ fullName: name.trim() });
        }}
        className="space-y-3"
      >
        <div className="space-y-1.5">
          <Label htmlFor="full-name">Name</Label>
          <Input id="full-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={user?.email ?? ""} disabled />
        </div>
        <Button type="submit" size="sm" disabled={save.busy}>
          {save.busy ? "Saving…" : "Save"}
        </Button>
      </form>

      <div className="border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {roles.map((role) => (
            <StatusPill key={role} tone={role === "admin" ? "info" : "default"}>
              {ROLE_LABEL[role]}
            </StatusPill>
          ))}
        </div>
        {roles[0] && (
          <p className="mt-1.5 text-xs text-muted-foreground">{ROLE_DESCRIPTION[roles[0]]}</p>
        )}
      </div>

      <div className="border-t pt-4">
        <Button variant="outline" size="sm" onClick={() => void sendReset()} disabled={sending}>
          {sending ? "Sending…" : "Send me a password reset link"}
        </Button>
      </div>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  return (
    <Card className="space-y-3 rounded-[14px] p-5">
      <h2 className="font-display text-[22px] leading-tight">Appearance</h2>
      <div className="space-y-1.5">
        <Label htmlFor="theme">Theme</Label>
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger id="theme" className="max-w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Match my system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function WorkspaceCard() {
  const { workspace, workspaceId, refetchWorkspaces } = useAuth();
  const [name, setName] = useState(workspace?.name ?? "");
  const [supportEmail, setSupportEmail] = useState(workspace?.support_email ?? "");
  const [website, setWebsite] = useState(workspace?.website ?? "");
  const [brandColor, setBrandColor] = useState(workspace?.brand_color ?? "");
  const [logoUrl, setLogoUrl] = useState(workspace?.logo_url ?? "");
  const [invoicePrefix, setInvoicePrefix] = useState(workspace?.invoice_prefix ?? "");

  useEffect(() => {
    setName(workspace?.name ?? "");
    setSupportEmail(workspace?.support_email ?? "");
    setWebsite(workspace?.website ?? "");
    setBrandColor(workspace?.brand_color ?? "");
    setLogoUrl(workspace?.logo_url ?? "");
    setInvoicePrefix(workspace?.invoice_prefix ?? "");
  }, [workspace]);

  const save = useServerAction(useServerFn(updateWorkspace), {
    label: "workspaces.update",
    success: "Workspace saved",
    invalidate: [qk.workspaces(), qk.workspace(workspaceId ?? undefined)],
    onSuccess: () => {
      void refetchWorkspaces();
    },
  });

  if (!workspace || !workspaceId) return null;

  return (
    <Card className="space-y-4 rounded-[14px] p-5">
      <div>
        <h2 className="font-display text-[22px] leading-tight">Workspace</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How this workspace appears to clients — name, contact details and invoice numbering.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.fire({
            workspaceId,
            name: name.trim() || undefined,
            supportEmail: supportEmail.trim() || null,
            website: website.trim() || null,
            brandColor: brandColor.trim() || null,
            logoUrl: logoUrl.trim(),
            invoicePrefix: invoicePrefix.trim() || undefined,
          });
        }}
        className="space-y-3"
      >
        <div className="space-y-1.5">
          <Label htmlFor="ws-name">Name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-support-email">Support email</Label>
          <Input
            id="ws-support-email"
            type="email"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            placeholder="support@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-website">Website</Label>
          <Input
            id="ws-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-logo">Logo URL</Label>
            <Input
              id="ws-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…/logo.png"
            />
            <p className="text-xs text-muted-foreground">
              Shown in the sidebar and on the client portal. Use a square image.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-brand-color">Brand colour</Label>
            <div className="flex gap-2">
              <Input
                id="ws-brand-color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#1a1a1a"
              />
              <Input
                aria-label="Pick brand colour"
                type="color"
                className="w-14 px-1"
                value={/^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : "#1a1a1a"}
                onChange={(e) => setBrandColor(e.target.value)}
              />
            </div>
            <div className="flex gap-2.5 pt-1" role="group" aria-label="Brand colour presets">
              {BRAND_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Use ${hex}`}
                  aria-pressed={brandColor.toLowerCase() === hex}
                  onClick={() => setBrandColor(hex)}
                  style={{ backgroundColor: hex }}
                  className={`h-7 w-7 rounded-full ${
                    brandColor.toLowerCase() === hex
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      : ""
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Applied to buttons and highlights for everyone in this workspace, including clients.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-invoice-prefix">Invoice prefix</Label>
            <Input
              id="ws-invoice-prefix"
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
              placeholder="INV"
            />
          </div>
        </div>
        <Button type="submit" size="sm" disabled={save.busy}>
          {save.busy ? "Saving…" : "Save workspace"}
        </Button>
      </form>
    </Card>
  );
}

function NotificationsCard() {
  const { user } = useAuth();
  const prefs = useQuery({
    ...notificationPreferencesQuery(user?.id ?? ""),
    enabled: Boolean(user),
  });

  const save = useServerAction(useServerFn(saveNotificationPreferences), {
    label: "notifications.savePreferences",
    success: "Saved",
    invalidate: [qk.notificationPrefs()],
  });

  const [local, setLocal] = useState<Record<string, { in_app: boolean; email: boolean }> | null>(
    null,
  );
  const current =
    local ??
    Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        {
          in_app: channelEnabled(prefs.data, kind, "in_app"),
          email: channelEnabled(prefs.data, kind, "email"),
        },
      ]),
    );

  return (
    <QueryState query={prefs} errorTitle="Couldn't load your preferences">
      {(row) => (
        <Card className="space-y-5 rounded-[14px] p-5">
          <div>
            <h2 className="font-display text-[22px] leading-tight">What we tell you about</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              In-app notifications always appear in your Inbox. Email is what reaches you when
              you&rsquo;re not here.
            </p>
          </div>

          <ul className="space-y-3">
            {KINDS.map((kind) => (
              <li
                key={kind}
                className="flex flex-wrap items-start gap-3 border-b pb-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{NOTIFICATION_KIND_LABEL[kind]}</p>
                  <p className="text-xs text-muted-foreground">
                    {NOTIFICATION_KIND_DESCRIPTION[kind]}
                  </p>
                </div>
                <div className="flex shrink-0 gap-4">
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={current[kind].in_app}
                      onCheckedChange={(next) =>
                        setLocal({ ...current, [kind]: { ...current[kind], in_app: next } })
                      }
                      aria-label={`${NOTIFICATION_KIND_LABEL[kind]} in app`}
                    />
                    In app
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={current[kind].email}
                      onCheckedChange={(next) =>
                        setLocal({ ...current, [kind]: { ...current[kind], email: next } })
                      }
                      aria-label={`${NOTIFICATION_KIND_LABEL[kind]} by email`}
                    />
                    Email
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quiet-start">Quiet from</Label>
              <Input
                id="quiet-start"
                type="number"
                min={0}
                max={23}
                defaultValue={row?.quiet_hours_start ?? ""}
                placeholder="22"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-end">Quiet until</Label>
              <Input
                id="quiet-end"
                type="number"
                min={0}
                max={23}
                defaultValue={row?.quiet_hours_end ?? ""}
                placeholder="7"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Emails hold until quiet hours are over. Mentions always get through.
          </p>

          <Button
            size="sm"
            disabled={save.busy}
            onClick={() => {
              const start = Number(
                (document.getElementById("quiet-start") as HTMLInputElement | null)?.value,
              );
              const end = Number(
                (document.getElementById("quiet-end") as HTMLInputElement | null)?.value,
              );
              save.fire({
                channels: current,
                digestFrequency: (row?.digest_frequency as "off" | "daily" | "weekly") ?? "daily",
                quietHoursStart: Number.isFinite(start) && start >= 0 ? start : null,
                quietHoursEnd: Number.isFinite(end) && end >= 0 ? end : null,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              });
            }}
          >
            {save.busy ? "Saving…" : "Save preferences"}
          </Button>
        </Card>
      )}
    </QueryState>
  );
}

function IntegrationsCard() {
  const status = useQuery({
    queryKey: [...qk.all, "integrations"] as const,
    queryFn: () => getIntegrationStatus(),
  });

  const github = useQuery({
    queryKey: qk.githubStatus(),
    queryFn: () => getGitHubStatus(),
  });

  return (
    <QueryState query={status} errorTitle="Couldn't check integrations">
      {(data) => (
        <Card className="space-y-4 rounded-[14px] p-5">
          <div>
            <h2 className="font-display text-[22px] leading-tight">Integrations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything here is optional. Without a key the feature still works — it just works
              locally instead of reaching the outside world.
            </p>
          </div>

          <ul className="space-y-3">
            <Integration
              name="GitHub"
              provider={{
                name: github.data?.login ? `@${github.data.login}` : "GitHub",
                enabled: Boolean(github.data?.connected),
              }}
              onWhen={
                github.data?.source === "workspace"
                  ? "Using the shared token on this server. Connect your own in the GitHub card below and it is used for you instead."
                  : "Using your own token: repositories and pull requests link to projects and plan tasks."
              }
              offWhen={
                github.data?.problem ??
                "Repository pickers and pull request status stay empty. Plans and tickets work without it."
              }
              key_="your own token in the GitHub card below"
            />
            <Integration
              name="Email"
              provider={data.email}
              onWhen="Clients get notified by email."
              offWhen="Messages are written to the Outbox tab instead of being sent."
              key_="RESEND_API_KEY and EMAIL_FROM"
            />
            <Integration
              name="Payments"
              provider={data.payments}
              onWhen="Clients can pay invoices by card."
              offWhen="Invoices are settled with Mark as paid. Everything else is identical."
              key_="STRIPE_SECRET_KEY"
            />
            <Integration
              name="Error reporting"
              provider={data.errors}
              onWhen="Crashes are reported to Sentry."
              offWhen="Crashes are recorded in the Errors tab."
              key_="SENTRY_DSN"
            />
            <Integration
              name="AI"
              provider={data.ai}
              onWhen={`Drafting, triage and summaries, using ${data.ai.model}.`}
              offWhen="AI features are hidden. Nothing else changes."
              key_="AI_API_KEY"
            />
          </ul>
        </Card>
      )}
    </QueryState>
  );
}

function Integration({
  name,
  provider,
  onWhen,
  offWhen,
  key_,
}: {
  name: string;
  provider: { name: string; enabled: boolean };
  onWhen: string;
  offWhen: string;
  key_: string;
}) {
  return (
    <li className="border-b pb-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name}</span>
        <StatusPill tone={provider.enabled ? "success" : "default"}>
          {provider.enabled ? `Connected — ${provider.name}` : "Not connected"}
        </StatusPill>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{provider.enabled ? onWhen : offWhen}</p>
      {!provider.enabled && (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">Set {key_} to enable.</p>
      )}
    </li>
  );
}

function OutboxCard() {
  const outbox = useQuery({
    queryKey: qk.outbox(),
    queryFn: () => listOutbox({ data: { limit: 50 } }),
  });

  return (
    <QueryState query={outbox} errorTitle="Couldn't load the outbox">
      {(data) => (
        <Card className="rounded-[14px] p-5">
          <h2 className="font-display text-[22px] leading-tight">Outbox</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Every message the app composed. With no email provider configured these are recorded
            rather than sent — this is what your clients would have received.
          </p>

          {data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y">
              {data.map((message) => (
                <li key={message.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={
                        message.status === "sent"
                          ? "success"
                          : message.status === "failed"
                            ? "destructive"
                            : "default"
                      }
                    >
                      {message.status}
                    </StatusPill>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {message.subject}
                    </span>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(message.created_at)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">To {message.to_address}</p>
                  {message.body_text && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                      {message.body_text}
                    </p>
                  )}
                  {message.error && (
                    <p className="mt-1 text-xs text-destructive">{message.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </QueryState>
  );
}

function ErrorsCard() {
  const errors = useQuery({
    queryKey: qk.appErrors(),
    queryFn: () => listAppErrors({ data: { limit: 100 } }),
  });

  return (
    <QueryState query={errors} errorTitle="Couldn't load errors">
      {(data) => (
        <Card className="rounded-[14px] p-5">
          <h2 className="font-display text-[22px] leading-tight">Errors</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Grouped by cause, newest first. A client hitting a crash shows up here without them
            having to tell you.
          </p>

          {data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing broken. Good.</p>
          ) : (
            <ul className="divide-y">
              {data.map((group) => (
                <li key={group.fingerprint} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={group.count > 5 ? "destructive" : "warning"}>
                      {group.count}×
                    </StatusPill>
                    <StatusPill>{group.side}</StatusPill>
                    <time className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatRelative(group.lastSeen)}
                    </time>
                  </div>
                  <p className="mt-1 break-words font-mono text-xs">{group.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </QueryState>
  );
}
