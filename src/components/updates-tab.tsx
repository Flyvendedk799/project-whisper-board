import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { postUpdate } from "@/lib/meetings.functions";
import { projectUpdatesQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import { UPDATE_KIND_LABEL } from "@/data/enums";
import { formatRelative, initials } from "@/lib/utils-format";

function updateDeepLink(
  data: Record<string, unknown> | null,
): { label: string; tab: string } | null {
  if (!data) return null;
  if (typeof data.tab === "string") {
    return {
      label: data.tab === "milestones" ? "Open milestones" : `Open ${data.tab}`,
      tab: data.tab,
    };
  }
  if (data.quote_id || data.invoice_id) {
    return { label: "Open in Billing", tab: "billing" };
  }
  return null;
}

/**
 * The project's activity feed.
 *
 * It used to contain only what the owner remembered to write. Now milestones,
 * quotes, invoices and meetings post themselves from the database, so a client
 * checking in sees progress without anyone having to narrate it.
 */
export function UpdatesTab({ projectId }: { projectId: string }) {
  const { isAdmin } = useAuth();
  const updates = useQuery(projectUpdatesQuery(projectId));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const post = useServerAction(useServerFn(postUpdate), {
    label: "updates.post",
    success: "Posted",
    invalidate: [qk.projectUpdates(projectId)],
    onSuccess: () => {
      setTitle("");
      setBody("");
    },
  });

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card className="p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              post.fire({ projectId, title: title.trim(), body: body.trim() || undefined });
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="update-title">Post an update</Label>
              <Input
                id="update-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Shipped the new checkout"
              />
            </div>
            {title && (
              <div className="space-y-1.5">
                <Label htmlFor="update-body" className="sr-only">
                  Details
                </Label>
                <Textarea
                  id="update-body"
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Anything worth adding."
                />
              </div>
            )}
            <Button type="submit" size="sm" disabled={post.busy || !title.trim()}>
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {post.busy ? "Posting…" : "Post"}
            </Button>
          </form>
        </Card>
      )}

      <QueryState
        query={updates}
        errorTitle="Couldn't load the feed"
        empty={
          <Card>
            <EmptyState
              icon={Megaphone}
              title="Nothing yet"
              description={
                isAdmin
                  ? "Milestones, quotes and payments post here on their own. Anything else, write it above."
                  : "Progress on this project will show up here."
              }
            />
          </Card>
        }
      >
        {(data) => (
          <ol className="space-y-3">
            {data.map((update) => {
              const deepLink = updateDeepLink(
                (update.data as Record<string, unknown> | null) ?? null,
              );
              return (
                <li key={update.id}>
                  <Card className="p-4">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[10px]"
                        aria-hidden="true"
                      >
                        {update.author
                          ? initials(update.author.full_name ?? update.author.email)
                          : "•"}
                      </span>
                      <span className="font-medium text-foreground">
                        {update.author?.full_name ?? update.author?.email ?? "Consflow"}
                      </span>
                      <span>{UPDATE_KIND_LABEL[update.kind]}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={update.created_at}>{formatRelative(update.created_at)}</time>
                      {update.kind !== "post" && <StatusPill>Automatic</StatusPill>}
                    </div>
                    {update.title && <h3 className="font-medium">{update.title}</h3>}
                    {update.body && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {update.body}
                      </p>
                    )}
                    {deepLink && (
                      <p className="mt-2">
                        <Link
                          to="/app/projects/$projectId"
                          params={{ projectId }}
                          search={{ tab: deepLink.tab }}
                          className="text-sm underline underline-offset-2"
                        >
                          {deepLink.label}
                        </Link>
                      </p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
    </div>
  );
}
