import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
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

const INBOX_BUTTON =
  "h-7 px-2.5 text-[13px] max-md:h-11 max-md:flex-1 max-md:border max-md:border-input max-md:text-sm";

function InboxOpenLink({ link, onOpen }: { link: string; onOpen: () => void }) {
  const ticket = /^\/app\/tickets\/([^/?#]+)/.exec(link);
  if (ticket) {
    return (
      <Button variant="ghost" size="sm" className={INBOX_BUTTON} asChild>
        <Link to="/app/tickets/$ticketId" params={{ ticketId: ticket[1] }} onClick={onOpen}>
          Open
        </Link>
      </Button>
    );
  }
  const project = /^\/app\/projects\/([^/?#]+)/.exec(link);
  if (project) {
    return (
      <Button variant="ghost" size="sm" className={INBOX_BUTTON} asChild>
        <Link to="/app/projects/$projectId" params={{ projectId: project[1] }} onClick={onOpen}>
          Open
        </Link>
      </Button>
    );
  }
  if (link.startsWith("/app")) {
    return (
      <Button variant="ghost" size="sm" className={INBOX_BUTTON} asChild>
        <Link to={link as "/app"} onClick={onOpen}>
          Open
        </Link>
      </Button>
    );
  }
  return null;
}

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
        maxWidth="max-w-[760px]"
        action={
          unread.length > 0 && (
            <Button
              variant="outline"
              className="max-md:w-full"
              disabled={markRead.busy}
              onClick={() => markRead.fire({})}
            >
              Mark all read
            </Button>
          )
        }
      />

      <div className="mx-auto max-w-[760px] px-4 py-4 md:px-8 md:py-7">
        <QueryState
          query={notifications}
          errorTitle="Couldn't load your inbox"
          empty={
            <div className="rounded-[14px] border bg-card">
              <EmptyState
                title="All clear"
                description="Ticket activity, replies and milestones land here."
              />
            </div>
          }
        >
          {(data) => (
            <ul className="overflow-hidden rounded-[14px] border bg-card">
              {data.map((notification) => {
                const open = () => {
                  if (!notification.read_at) markRead.fire({ ids: [notification.id] });
                };

                return (
                  <li
                    key={notification.id}
                    className={`flex items-center gap-3 border-t px-4 py-[13px] first:border-t-0 transition-colors hover:bg-surface max-md:min-h-14 max-md:flex-wrap max-md:items-start max-md:py-3 ${
                      notification.read_at ? "opacity-60" : "max-md:bg-accent/30"
                    }`}
                  >
                    {!notification.read_at ? (
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full bg-primary max-md:mt-[7px] max-md:h-2 max-md:w-2"
                        aria-label="Unread"
                        role="img"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 max-md:basis-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words text-sm font-medium leading-snug">
                          {notification.title}
                        </span>
                        <StatusPill>{NOTIFICATION_KIND_LABEL[notification.kind]}</StatusPill>
                      </div>
                      {notification.body && (
                        <p className="mt-0.5 break-words text-[13px] leading-snug text-muted-foreground max-md:line-clamp-3">
                          {notification.body}
                        </p>
                      )}
                    </div>

                    <time
                      dateTime={notification.created_at}
                      className="shrink-0 whitespace-nowrap text-xs text-muted-foreground max-md:mt-0.5"
                    >
                      {formatRelative(notification.created_at)}
                    </time>

                    <div className="flex shrink-0 gap-1 max-md:w-full max-md:gap-2 max-md:empty:hidden">
                      {notification.link && (
                        <InboxOpenLink link={notification.link} onOpen={open} />
                      )}
                      {!notification.read_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={INBOX_BUTTON}
                          onClick={() => markRead.fire({ ids: [notification.id] })}
                        >
                          Mark read
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </div>
    </>
  );
}
