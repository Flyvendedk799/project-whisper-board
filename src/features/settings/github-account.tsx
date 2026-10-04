import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useServerAction } from "@/lib/use-server-action";
import { connectGitHub, disconnectGitHub, getGitHubStatus } from "@/lib/github.functions";
import type { GitHubConnection } from "@/lib/github-token";
import { qk } from "@/data/keys";

const NEW_FINE_GRAINED = "https://github.com/settings/personal-access-tokens/new";
const NEW_CLASSIC = "https://github.com/settings/tokens/new?scopes=repo&description=Boared";

/**
 * Your own GitHub token.
 *
 * Per person, not per deployment: pull requests are read and merged as you, with what your token is
 * allowed to do, so a plan's Pull requests tab works for anyone who connects theirs. The server keeps
 * the token sealed and never sends it back; this card only ever shows who it belongs to.
 */
export function GitHubAccountCard() {
  const connection = useQuery({
    queryKey: qk.githubStatus(),
    queryFn: () => getGitHubStatus(),
  });

  const [token, setToken] = useState("");

  const connect = useServerAction<{ token: string }, GitHubConnection>(useServerFn(connectGitHub), {
    label: "github.connect",
    errorMessage: "Couldn't connect GitHub.",
    invalidate: () => [qk.githubStatus(), [...qk.plans(), "pulls"]],
    onSuccess: (result) => {
      setToken("");
      toast.success(result.login ? `GitHub connected as @${result.login}.` : "GitHub connected.");
    },
  });

  const remove = useServerAction<undefined, GitHubConnection>(useServerFn(disconnectGitHub), {
    label: "github.disconnect",
    errorMessage: "Couldn't disconnect.",
    invalidate: () => [qk.githubStatus(), [...qk.plans(), "pulls"]],
    onSuccess: () => {
      toast.success("Your GitHub token was removed.");
    },
  });

  return (
    <QueryState query={connection} errorTitle="Couldn't check your GitHub connection">
      {(data) => {
        const own = data.source === "user";
        const shared = data.source === "workspace";
        return (
          <Card
            className="space-y-4 rounded-[14px] p-5 max-md:p-4"
            data-testid="github-account-card"
          >
            <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-[22px] leading-tight">GitHub</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect your own GitHub token to read plan pull requests, put them in merge order,
                  and merge them from here. It acts as you, with whatever your token may do.
                </p>
              </div>
              <StatusPill
                tone={data.connected ? "success" : data.problem ? "warning" : "default"}
                className="max-md:max-w-full max-md:whitespace-normal max-md:break-all"
              >
                {data.connected
                  ? data.login
                    ? `@${data.login}`
                    : "Connected"
                  : data.problem
                    ? "Needs attention"
                    : "Not connected"}
              </StatusPill>
            </div>

            {!data.available && !shared && (
              <p className="text-sm text-muted-foreground">
                This deployment has nowhere to keep a token, so a personal GitHub connection is
                unavailable.
              </p>
            )}

            {data.problem && (
              <p className="rounded-lg bg-warning/15 p-3 text-sm" role="status">
                {data.problem}
              </p>
            )}

            {shared && (
              <p className="text-sm text-muted-foreground" role="status">
                You are using the shared token this server has (<code>GITHUB_PAT</code>). Connect
                your own below and it takes over for you.
              </p>
            )}

            {own && data.connected && (
              <p className="text-sm text-muted-foreground">
                {data.hint ? (
                  <>
                    Token <code>{data.hint}</code>.{" "}
                  </>
                ) : null}
                {data.scopes && data.scopes.length > 0
                  ? `Scopes: ${data.scopes.join(", ")}.`
                  : "Fine-grained tokens do not list scopes; merging needs Contents and Pull requests write access."}
              </p>
            )}

            {own && (
              <Button
                variant="outline"
                className="max-md:w-full"
                onClick={() => remove.fire(undefined)}
                disabled={remove.busy}
              >
                {remove.busy ? "Removing…" : "Disconnect"}
              </Button>
            )}

            {data.available && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  connect.fire({ token });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="github-token">
                    {own ? "Replace your token" : "Your GitHub token"}
                  </Label>
                  <Input
                    id="github-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="github_pat_… or ghp_…"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="done"
                    spellCheck={false}
                  />
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    <a
                      href={NEW_FINE_GRAINED}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-foreground underline underline-offset-4 max-md:py-2.5"
                    >
                      Create a fine-grained token <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>{" "}
                    for the repositories you merge in, with{" "}
                    <strong>Contents: Read and write</strong> and{" "}
                    <strong>Pull requests: Read and write</strong> (Metadata: Read-only is added for
                    you).
                  </p>
                  <p>
                    Or{" "}
                    <a
                      href={NEW_CLASSIC}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-foreground underline underline-offset-4 max-md:py-2.5"
                    >
                      create a classic token
                    </a>{" "}
                    with the <code>repo</code> scope. It is checked with GitHub before it is kept,
                    and stored encrypted.
                  </p>
                </div>

                <Button
                  type="submit"
                  className="max-md:w-full"
                  disabled={connect.busy || token.trim().length === 0}
                >
                  {connect.busy ? "Checking…" : own ? "Replace token" : "Connect GitHub"}
                </Button>
              </form>
            )}
          </Card>
        );
      }}
    </QueryState>
  );
}
