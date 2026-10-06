import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { organizationsQuery, projectMembersQuery } from "@/data/projects";
import { ROLE_LABEL } from "@/data/enums";
import { PersonAvatar } from "@/components/person-avatar";
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
    <section className="rounded-[14px] border bg-card p-5 max-md:p-4">
      <h2 className="font-display text-[22px] leading-tight">Client</h2>
      {org && (
        <div className="mt-3">
          <div className="font-medium">{org.name}</div>
          {org.website && (
            <a
              href={/^https?:\/\//.test(org.website) ? org.website : `https://${org.website}`}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[13px] text-primary hover:underline max-md:inline-block max-md:py-1.5"
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
              <PersonAvatar person={member.profile ?? { id: member.user_id }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {member.profile?.full_name ?? member.profile?.email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {member.profile?.email}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {ROLE_LABEL[member.role as keyof typeof ROLE_LABEL] ?? member.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
