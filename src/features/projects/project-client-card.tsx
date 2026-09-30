import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { organizationsQuery, projectMembersQuery } from "@/data/projects";
import { ROLE_LABEL } from "@/data/enums";
import { initials } from "@/lib/utils-format";
import type { Project } from "@/data/types";

/**
 * "Who is this for": the client company and the people on this project who
 * represent it. Shown on the client Overview so a project reads as a
 * relationship, not just a progress bar.
 */
export function ProjectClientCard({
  project,
}: {
  project: Pick<Project, "id" | "organization_id">;
}) {
  const { workspaceId } = useAuth();
  const orgs = useQuery(organizationsQuery(workspaceId));
  const members = useQuery(projectMembersQuery(project.id));

  const org = (orgs.data ?? []).find((row) => row.id === project.organization_id);
  const contacts = (members.data ?? []).filter(
    (member) => member.role === "client" || member.role === "client_admin",
  );
  if (!org && contacts.length === 0) return null;

  return (
    <section className="rounded-[14px] border bg-card p-5">
      <h2 className="font-display text-[22px] leading-tight">Client</h2>
      {org && (
        <div className="mt-3">
          <div className="font-medium">{org.name}</div>
          {org.website && (
            <a
              href={/^https?:\/\//.test(org.website) ? org.website : `https://${org.website}`}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] text-primary hover:underline"
            >
              {org.website}
            </a>
          )}
        </div>
      )}
      {contacts.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {contacts.map((member) => (
            <li key={member.id} className="flex items-center gap-3">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold"
                aria-hidden="true"
              >
                {initials(member.profile?.full_name ?? member.profile?.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {member.profile?.full_name ?? member.profile?.email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {member.profile?.email}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {ROLE_LABEL[member.role as keyof typeof ROLE_LABEL] ?? member.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
