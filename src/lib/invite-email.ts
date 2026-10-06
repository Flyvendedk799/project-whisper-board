/**
 * The email an already-registered person gets when they are invited to a
 * workspace or project. Supabase Auth only mails *new* accounts
 * (`inviteUserByEmail`), so for someone who already has a login the app sends
 * this itself, through the same provider and Outbox as every notification.
 *
 * Pure: the caller supplies the absolute link (from `appUrl`).
 */

export type InviteEmailInput = {
  /** Who sent the invite; falls back to "Someone". */
  inviterName?: string | null;
  workspaceName?: string | null;
  projectTitle?: string | null;
  /** Absolute URL of the accept page. */
  url: string;
};

export type InviteEmail = { subject: string; text: string; html: string };

/** Where an invite lands: the accept page, carrying the project when there is one. */
export function inviteAcceptPath(projectId?: string | null): string {
  return projectId
    ? `/app/projects/${encodeURIComponent(projectId)}?invite_prompt=true`
    : "/app?invite_prompt=true";
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inviteEmail(input: InviteEmailInput): InviteEmail {
  const inviter = clean(input.inviterName) || "Someone";
  const workspace = clean(input.workspaceName);
  const project = clean(input.projectTitle);
  const target = project
    ? workspace
      ? `${project} (${workspace})`
      : project
    : workspace || "a workspace";

  const subject = `${inviter} invited you to ${target} on Boared`;
  const lead = `${inviter} invited you to ${target} on Boared.`;
  const signIn =
    'Sign in with this email address to open it. No password? Choose "Magic link" on the sign-in page.';

  const text = [
    lead,
    "",
    signIn,
    "",
    `Open ${project ? "the project" : "Boared"}: ${input.url}`,
  ].join("\n");

  const href = escapeHtml(input.url);
  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    `<p>${escapeHtml(signIn)}</p>`,
    `<p><a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:6px;` +
      `background:#111827;color:#ffffff;text-decoration:none;font-weight:600">` +
      `Open ${project ? "the project" : "Boared"}</a></p>`,
    `<p style="color:#6b7280;font-size:12px">Or paste this link into your browser: ${href}</p>`,
  ].join("\n");

  return { subject, text, html };
}
