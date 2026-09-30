import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useServerAction } from "@/lib/use-server-action";
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
import { qk } from "@/data/keys";

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
export function ClaudeAccountCard() {
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
        <Card className="space-y-4 rounded-[14px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-[22px] leading-tight">Claude subscription</h2>
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

export function AntigravityAccountCard() {
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
        <Card className="space-y-4 rounded-[14px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-[22px] leading-tight">
                Antigravity subscription (Google)
              </h2>
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
