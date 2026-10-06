import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { PageHeader } from "@/components/page-header";
import { EmptyState, StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import {
  inviteClient,
  removeWorkspaceMember,
  resendInvite,
  setWorkspaceMemberRole,
} from "@/lib/admin.functions";
import { workspaceMembersQuery, type WorkspaceMemberRow } from "@/data/projects";
import { qk } from "@/data/keys";
import { ROLE_LABEL, type AppRole } from "@/data/enums";
import { formatRelative } from "@/lib/utils-format";
import { PersonAvatar, personName } from "@/components/person-avatar";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";

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
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="Admins manage the team"
              description="Ask an admin to invite you if you need a different role."
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team"
        maxWidth="max-w-3xl"
        description="Agency and clients who can sign in. Clients here are the same people as on Clients."
        action={<InviteTeammateButton />}
      />
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-7">
        <QueryState
          query={members}
          errorTitle="Couldn't load the team"
          empty={
            <div className="rounded-[14px] border bg-card">
              <EmptyState
                title="Just you so far"
                description="Invite an admin or a client."
                action={<InviteTeammateButton />}
              />
            </div>
          }
        >
          {(rows) => (
            <ul className="divide-y overflow-hidden rounded-[14px] border bg-card">
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
  member: WorkspaceMemberRow;
  workspaceId: string;
  isSelf: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = personName(member.profile, "Invited");
  const setRole = useServerAction(useServerFn(setWorkspaceMemberRole), {
    label: "team.setRole",
    success: "Role updated",
    invalidate: [qk.workspacePeople(workspaceId), qk.profiles()],
  });
  const remove = useServerAction(useServerFn(removeWorkspaceMember), {
    label: "team.remove",
    success: member.pending ? "Invite revoked" : "Removed from the workspace",
    invalidate: [qk.workspacePeople(workspaceId), qk.profiles()],
    onSuccess: () => setConfirming(false),
  });
  const resend = useServerAction(useServerFn(resendInvite), {
    label: "team.resendInvite",
    success: (result) =>
      result.via === "invite" ? "Invite sent again" : "Sent them a link to set a password",
    invalidate: [qk.workspacePeople(workspaceId)],
  });

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-surface max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-y-3 max-md:py-4">
      <PersonAvatar
        person={member.profile ?? { id: member.user_id }}
        pending={member.pending}
        className="max-md:h-10 max-md:w-10 max-md:text-xs"
      />
      <div className="min-w-0 flex-1 max-md:col-span-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">
            {name}
            {isSelf ? " (you)" : ""}
          </span>
          {member.pending ? (
            <StatusPill tone="warning">Pending</StatusPill>
          ) : (
            <StatusPill tone="success">Accepted</StatusPill>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.profile?.email}
          {member.pending && member.invited_at
            ? ` · Invited ${formatRelative(member.invited_at)}`
            : !member.pending && member.last_sign_in_at
              ? ` · Signed in ${formatRelative(member.last_sign_in_at)}`
              : ""}
        </div>
      </div>
      <StatusPill className="max-md:hidden">{ROLE_LABEL[member.role]}</StatusPill>
      <Select
        value={member.role}
        onValueChange={(role) =>
          setRole.fire({ workspaceId, userId: member.user_id, role: role as AppRole })
        }
        disabled={setRole.busy}
      >
        <SelectTrigger
          className="h-[34px] w-36 max-md:col-span-2 max-md:col-start-1 max-md:w-full"
          aria-label={`Role for ${name}`}
        >
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
      <div className="flex items-center gap-1 max-md:justify-end">
        {member.pending ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resend.busy}
            aria-label={`Resend invite to ${name}`}
            onClick={() => resend.fire({ workspaceId, userId: member.user_id })}
          >
            {resend.busy ? "Sending…" : "Resend"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isSelf || remove.busy}
          aria-label={`${member.pending ? "Revoke invite for" : "Remove"} ${name}`}
          onClick={() => setConfirming(true)}
        >
          {member.pending ? "Revoke" : "Remove"}
        </Button>
      </div>
      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={member.pending ? `Revoke ${name}'s invite?` : `Remove ${name}?`}
        confirmLabel={member.pending ? "Revoke invite" : "Remove"}
        busyLabel={member.pending ? "Revoking…" : "Removing…"}
        busy={remove.busy}
        onConfirm={() => remove.fire({ workspaceId, userId: member.user_id })}
      >
        <p>
          {member.pending
            ? "The link they were sent no longer gets them into this workspace. You can invite them again later."
            : "They lose access to this workspace and its projects. Their tickets and comments stay."}
        </p>
      </ConfirmDeleteDialog>
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
        <Button>
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Invite someone</DialogTitle>
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
            <Input id="invite-name" name="name" autoComplete="name" enterKeyHint="next" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="send"
              required
            />
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.busy}>
              {invite.busy ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
