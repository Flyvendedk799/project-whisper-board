import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Bell, Inbox, Palette, Plug, User } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { useTheme, type Theme } from "@/components/theme-provider";
import { useDataMutation, useServerAction } from "@/lib/use-server-action";
import { saveNotificationPreferences } from "@/lib/notifications.functions";
import {
  claudeConnection,
  finishClaudeConnection,
  removeClaudeConnection,
  startClaudeConnection,
} from "@/lib/claude-auth.functions";
import type { ClaudeConnection } from "@/lib/ai-auth/claude";
import {
  antigravityConnection,
  finishAntigravityConnection,
  removeAntigravityConnection,
  startAntigravityConnection,
} from "@/lib/antigravity-auth.functions";
import type { AntigravityConnection } from "@/lib/ai-auth/antigravity";

import { getIntegrationStatus, listAppErrors, listOutbox } from "@/lib/admin-views.functions";
import { updateWorkspace } from "@/lib/workspace.functions";
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
  component: SettingsPage,
});

const KINDS = Constants.public.Enums.notification_kind;

function SettingsPage() {
  const { isAdmin } = useAuth();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <Tabs defaultValue="you">
          <TabsList className="flex-wrap">
            <TabsTrigger value="you">
              <User className="mr-1.5 h-4 w-4" aria-hidden="true" />
              You
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Notifications
            </TabsTrigger>
            {isAdmin && (
              <>
                <TabsTrigger value="integrations">
                  <Plug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Integrations
                </TabsTrigger>
                <TabsTrigger value="outbox">
                  <Inbox className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Outbox
                </TabsTrigger>
                <TabsTrigger value="errors">
                  <AlertTriangle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Errors
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="you" className="mt-6 space-y-6">
            <ProfileCard />
            {isAdmin && (
              <SectionBoundary label="workspace">
                <WorkspaceCard />
              </SectionBoundary>
            )}
            <SectionBoundary label="claude-account">
              <ClaudeAccountCard />
            </SectionBoundary>
            <SectionBoundary label="antigravity-account">
              <AntigravityAccountCard />
            </SectionBoundary>
            <AppearanceCard />
          </TabsContent>

          <TabsContent value="notifications" className="mt-6">
            <SectionBoundary label="notification-preferences">
              <NotificationsCard />
            </SectionBoundary>
          </TabsContent>

          {isAdmin && (
            <>
              <TabsContent value="integrations" className="mt-6">
                <SectionBoundary label="integrations">
                  <IntegrationsCard />
                </SectionBoundary>
              </TabsContent>
              <TabsContent value="outbox" className="mt-6">
                <SectionBoundary label="outbox">
                  <OutboxCard />
                </SectionBoundary>
              </TabsContent>
              <TabsContent value="errors" className="mt-6">
                <SectionBoundary label="app-errors">
                  <ErrorsCard />
                </SectionBoundary>
              </TabsContent>
            </>
          )}
        </Tabs>
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
    <Card className="space-y-4 p-5">
      <h2 className="font-display text-xl">Your details</h2>

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
    <Card className="space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-display text-xl">
        <Palette className="h-5 w-5" aria-hidden="true" />
        Appearance
      </h2>
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
  const [invoicePrefix, setInvoicePrefix] = useState(workspace?.invoice_prefix ?? "");

  useEffect(() => {
    setName(workspace?.name ?? "");
    setSupportEmail(workspace?.support_email ?? "");
    setWebsite(workspace?.website ?? "");
    setBrandColor(workspace?.brand_color ?? "");
    setInvoicePrefix(workspace?.invoice_prefix ?? "");
  }, [workspace]);

  const save = useServerAction(useServerFn(updateWorkspace), {
    label: "workspaces.update",
    success: "Workspace saved",
    invalidate: [qk.workspaces(), qk.workspace(workspaceId ?? undefined)],
    onSuccess: () => refetchWorkspaces(),
  });

  if (!workspace || !workspaceId) return null;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-display text-xl">Workspace</h2>
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
            <Label htmlFor="ws-brand-color">Brand colour</Label>
            <Input
              id="ws-brand-color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              placeholder="#1a1a1a"
            />
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
        <Card className="space-y-5 p-5">
          <div>
            <h2 className="font-display text-xl">What we tell you about</h2>
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

  return (
    <QueryState query={status} errorTitle="Couldn't check integrations">
      {(data) => (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-display text-xl">Integrations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything here is optional. Without a key the feature still works — it just works
              locally instead of reaching the outside world.
            </p>
          </div>

          <ul className="space-y-3">
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
          {provider.enabled ? `Live — ${provider.name}` : "Not configured"}
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
        <Card className="p-5">
          <h2 className="font-display text-xl">Outbox</h2>
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
        <Card className="p-5">
          <h2 className="font-display text-xl">Errors</h2>
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

/**
 * Your own Claude subscription.
 *
 * Lives on the "You" tab rather than under Integrations because it is not a
 * deployment setting: an admin configures which provider this install uses, but
 * whose plan pays for a call is each person's own choice, and everyone signed in
 * can make it.
 *
 * The login is a paste flow, not a redirect. Claude's authorize page hands the
 * code back on screen, so nothing has to come back to this origin — which also
 * means it works identically in a browser that never returns here.
 */
function ClaudeAccountCard() {
  const connection = useQuery({
    queryKey: [...qk.all, "claude-connection"] as const,
    queryFn: () => claudeConnection(),
  });

  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const begin = useServerAction<undefined, { url: string; expiresInSeconds: number }>(
    useServerFn(startClaudeConnection),
    {
      label: "claude.login",
      errorMessage: "Couldn't start the Claude login.",
      onSuccess: (result) => setAuthorizeUrl(result.url),
    },
  );

  const finish = useServerAction(useServerFn(finishClaudeConnection), {
    label: "claude.login.complete",
    errorMessage: "That code wasn't accepted.",
    invalidate: () => [[...qk.all, "claude-connection"]],
    onSuccess: () => {
      setAuthorizeUrl(null);
      setCode("");
      toast.success("Claude connected. AI now runs on your subscription.");
    },
  });

  const remove = useServerAction<undefined, ClaudeConnection>(useServerFn(removeClaudeConnection), {
    label: "claude.disconnect",
    errorMessage: "Couldn't disconnect.",
    invalidate: () => [[...qk.all, "claude-connection"]],
    onSuccess: () => {
      toast.success("Claude disconnected.");
    },
  });

  return (
    <QueryState query={connection} errorTitle="Couldn't check your Claude connection">
      {(data) => (
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl">Claude subscription</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with your own Claude plan and the AI features here run on it. Without one,
                AI uses whatever this workspace has configured — or stays hidden.
              </p>
            </div>
            <StatusPill tone={data.connected ? "success" : "default"}>
              {data.connected ? (data.plan ?? "Connected") : "Not connected"}
            </StatusPill>
          </div>

          {!data.available && (
            <p className="text-sm text-muted-foreground">
              This deployment has nowhere to keep a connection, so the feature is unavailable.
            </p>
          )}

          {data.available && data.connected && (
            <div className="space-y-3">
              {data.expired && (
                <p className="text-sm text-muted-foreground">
                  The access token has aged out. That is not a problem — it refreshes on the next
                  call.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => remove.fire(undefined)}
                disabled={remove.busy}
              >
                {remove.busy ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          )}

          {data.available && !data.connected && !authorizeUrl && (
            <Button onClick={() => begin.fire(undefined)} disabled={begin.busy}>
              {begin.busy ? "Starting…" : "Connect Claude"}
            </Button>
          )}

          {data.available && !data.connected && authorizeUrl && (
            <div className="space-y-3">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  <a
                    href={authorizeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline underline-offset-4"
                  >
                    Open the Claude authorize page
                  </a>{" "}
                  and approve access.
                </li>
                <li>Copy the code it shows you and paste it below.</li>
              </ol>

              <div className="space-y-2">
                <Label htmlFor="claude-code">Authorization code</Label>
                <Input
                  id="claude-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste the code from the Claude page"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => finish.fire({ code })}
                  disabled={finish.busy || code.trim().length === 0}
                >
                  {finish.busy ? "Connecting…" : "Finish connecting"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAuthorizeUrl(null);
                    setCode("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </QueryState>
  );
}

function AntigravityAccountCard() {
  const connection = useQuery({
    queryKey: [...qk.all, "antigravity-connection"] as const,
    queryFn: () => antigravityConnection(),
  });

  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const begin = useServerAction<undefined, { url: string; expiresInSeconds: number }>(
    useServerFn(startAntigravityConnection),
    {
      label: "antigravity.login",
      errorMessage: "Couldn't start the Antigravity login.",
      onSuccess: (result) => setAuthorizeUrl(result.url),
    },
  );

  const finish = useServerAction(useServerFn(finishAntigravityConnection), {
    label: "antigravity.login.complete",
    errorMessage: "That code wasn't accepted.",
    invalidate: () => [[...qk.all, "antigravity-connection"]],
    onSuccess: () => {
      setAuthorizeUrl(null);
      setCode("");
      toast.success("Antigravity connected. AI now runs on your Google subscription.");
    },
  });

  const remove = useServerAction<undefined, AntigravityConnection>(
    useServerFn(removeAntigravityConnection),
    {
      label: "antigravity.disconnect",
      errorMessage: "Couldn't disconnect.",
      invalidate: () => [[...qk.all, "antigravity-connection"]],
      onSuccess: () => {
        toast.success("Antigravity disconnected.");
      },
    },
  );

  return (
    <QueryState query={connection} errorTitle="Couldn't check your Antigravity connection">
      {(data) => (
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl">Antigravity subscription (Google)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with your own Google plan (Gemini Advanced/Code Assist) and the AI features
                here run on it. Without one, AI uses whatever this workspace has configured — or
                stays hidden.
              </p>
            </div>
            <StatusPill tone={data.connected ? "success" : "default"}>
              {data.connected ? (data.email ?? "Connected") : "Not connected"}
            </StatusPill>
          </div>

          {!data.available && (
            <p className="text-sm text-muted-foreground">
              This deployment has nowhere to keep a connection, so the feature is unavailable.
            </p>
          )}

          {data.available && data.connected && (
            <div className="space-y-3">
              {data.expired && (
                <p className="text-sm text-muted-foreground">
                  The access token has aged out. That is not a problem — it refreshes on the next
                  call.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => remove.fire(undefined)}
                disabled={remove.busy}
              >
                {remove.busy ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          )}

          {data.available && !data.connected && !authorizeUrl && (
            <Button onClick={() => begin.fire(undefined)} disabled={begin.busy}>
              {begin.busy ? "Starting…" : "Connect Antigravity"}
            </Button>
          )}

          {data.available && !data.connected && authorizeUrl && (
            <div className="space-y-3">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  <a
                    href={authorizeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline underline-offset-4"
                  >
                    Open the Google authorize page
                  </a>{" "}
                  and approve access.
                </li>
                <li>Copy the code or the redirect URL it shows you and paste it below.</li>
              </ol>

              <div className="space-y-2">
                <Label htmlFor="antigravity-code">Authorization code</Label>
                <Input
                  id="antigravity-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste the code or URL"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => finish.fire({ code })}
                  disabled={finish.busy || code.trim().length === 0}
                >
                  {finish.busy ? "Connecting…" : "Finish connecting"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAuthorizeUrl(null);
                    setCode("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </QueryState>
  );
}
