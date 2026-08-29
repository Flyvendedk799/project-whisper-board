import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { markNotificationsRead } from "@/lib/notifications.functions";
import { notificationListQuery } from "@/data/notifications";
import { qk } from "@/data/keys";
import { NOTIFICATION_KIND_LABEL } from "@/data/enums";
import { formatRelative } from "@/lib/utils-format";

export const Route = createFileRoute("/app/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const { user } = useAuth();
  const notifications = useQuery({ ...notificationListQuery(), enabled: Boolean(user) });

  const markRead = useServerAction(useServerFn(markNotificationsRead), {
    label: "notifications.markRead",
    invalidate: [qk.notifications()],
  });

  const unread = (notifications.data ?? []).filter((n) => !n.read_at);

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Replies, mentions and progress across your projects."
        action={
          unread.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={markRead.busy}
              onClick={() => markRead.fire({})}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Mark all read
            </Button>
          )
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <QueryState
          query={notifications}
          errorTitle="Couldn't load your inbox"
          empty={
            <Card>
              <EmptyState
                icon={Bell}
                title="All clear"
                description="Ticket activity, replies and milestones land here."
              />
            </Card>
          }
        >
          {(data) => (
            <Card className="divide-y">
              {data.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex items-start gap-3 p-4 ${notification.read_at ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{notification.title}</span>
                      <StatusPill>{NOTIFICATION_KIND_LABEL[notification.kind]}</StatusPill>
                      {!notification.read_at && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-primary"
                          aria-label="Unread"
                          role="img"
                        />
                      )}
                    </div>
                    {notification.body && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{notification.body}</p>
                    )}
                    <time
                      dateTime={notification.created_at}
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      {formatRelative(notification.created_at)}
                    </time>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    {notification.link && (
                      <Button variant="ghost" size="sm" asChild>
                        {/*
                          Links are stored as plain paths by the notification
                          fan-out, so this is an anchor rather than a typed Link.
                        */}
                        <a href={notification.link}>Open</a>
                      </Button>
                    )}
                    {!notification.read_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markRead.fire({ ids: [notification.id] })}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </QueryState>
      </div>
    </>
  );
}

export { Link };
