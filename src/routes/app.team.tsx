import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { inviteClient, removeWorkspaceMember, setWorkspaceMemberRole } from "@/lib/admin.functions";
import { workspaceMembersQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import { ROLE_LABEL, type AppRole } from "@/data/enums";

export const Route = createFileRoute("/app/team")({
  head: () => ({ meta: [{ title: "Team · Boared" }] }),
  component: TeamPage,
});

const ROLES: AppRole[] = ["admin", "client_admin", "client"];

function TeamPage() {
  const { isAdmin, workspaceId, user } = useAuth();
  const members = useQuery(workspaceMembersQuery(workspaceId));

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Team" />
        <div className="mx-auto max-w-3xl px-4 py-8">
          <Card>
            <EmptyState
              icon={Users}
              title="Admins manage the team"
              description="Ask an admin to invite you if you need a different role."
            />
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Agency and clients who can sign in. Clients here are the same people as on Clients."
        action={<InviteTeammateButton />}
      />
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <QueryState
          query={members}
          errorTitle="Couldn't load the team"
          empty={
            <Card>
              <EmptyState
                icon={Users}
                title="Just you so far"
                description="Invite an admin or a client."
                action={<InviteTeammateButton />}
              />
            </Card>
          }
        >
          {(rows) => (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {rows.map((member) => (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  workspaceId={workspaceId!}
                  isSelf={member.user_id === user?.id}
                />
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </>
  );
}

function MemberRow({
  member,
  workspaceId,
  isSelf,
}: {
  member: {
    user_id: string;
    role: AppRole;
    profile: { full_name: string | null; email: string | null } | null;
  };
  workspaceId: string;
  isSelf: boolean;
}) {
  const setRole = useServerAction(useServerFn(setWorkspaceMemberRole), {
    label: "team.setRole",
    success: "Role updated",
    invalidate: [qk.workspacePeople(workspaceId), qk.profiles()],
  });
  const remove = useServerAction(useServerFn(removeWorkspaceMember), {
    label: "team.remove",
    success: "Removed from the workspace",
    invalidate: [qk.workspacePeople(workspaceId), qk.profiles()],
  });

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {member.profile?.full_name || member.profile?.email || "Invited"}
          {isSelf ? " (you)" : ""}
        </div>
        <div className="truncate text-xs text-muted-foreground">{member.profile?.email}</div>
      </div>
      <Select
        value={member.role}
        onValueChange={(role) =>
          setRole.fire({ workspaceId, userId: member.user_id, role: role as AppRole })
        }
        disabled={setRole.busy}
      >
        <SelectTrigger className="w-40" aria-label="Role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABEL[role]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <StatusPill>{ROLE_LABEL[member.role]}</StatusPill>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isSelf || remove.busy}
        onClick={() => remove.fire({ workspaceId, userId: member.user_id })}
      >
        Remove
      </Button>
    </li>
  );
}

function InviteTeammateButton() {
  const { workspaceId } = useAuth();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole>("admin");
  const invite = useServerAction(useServerFn(inviteClient), {
    label: "team.invite",
    success: "Invite sent",
    invalidate: [qk.workspacePeople(workspaceId ?? undefined)],
    onSuccess: () => setOpen(false),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId) return;
            const form = new FormData(event.currentTarget);
            invite.fire({
              workspaceId,
              email: String(form.get("email")),
              fullName: String(form.get("name") || "") || undefined,
              role,
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name</Label>
            <Input id="invite-name" name="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Admins see every project. Clients only see projects you add them to.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={invite.busy}>
              {invite.busy ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
