import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { unreadCountQuery } from "@/data/notifications";

export function NotificationBell() {
  const { user } = useAuth();
  const { data: unread = 0 } = useQuery({ ...unreadCountQuery(), enabled: Boolean(user) });

  return (
    <Button
      variant="ghost"
      size="icon"
      asChild
      className="relative h-11 w-11 md:h-9 md:w-9"
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
    >
      <Link to="/app/inbox">
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
