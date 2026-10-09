/**
 * The polite reminder ("opfølgning") sent to someone who was invited to a
 * project but has not signed in yet. Danish, since the people it goes to are
 * Danish clients; the invitation itself stays as it was sent.
 *
 * Pure: the caller supplies the absolute link (from `appUrl`).
 */

export type FollowUpEmailInput = {
  /** Who is sending the reminder; falls back to "teamet". */
  senderName?: string | null;
  /** The invited person; used for the greeting. */
  recipientName?: string | null;
  workspaceName?: string | null;
  projectTitle?: string | null;
  /** Absolute URL of the project (or app) the invitation points at. */
  url: string;
};

export type FollowUpEmail = { subject: string; text: string; html: string };

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

/** "Hej Maja" for a name, "Hej" for none; an email address is not a name. */
function greeting(recipientName: string | null | undefined): string {
  const name = clean(recipientName);
  const first = name.includes("@") ? "" : name.split(" ")[0];
  return first ? `Hej ${first},` : "Hej,";
}

export function followUpEmail(input: FollowUpEmailInput): FollowUpEmail {
  const sender = clean(input.senderName) || "teamet";
  const workspace = clean(input.workspaceName);
  const project = clean(input.projectTitle);
  const target = project
    ? workspace
      ? `${project} (${workspace})`
      : project
    : workspace || "Boared";

  const subject = `Opfølgning på din invitation til ${target}`;
  const hello = greeting(input.recipientName);
  const intro = `Jeg skriver blot for at følge op på invitationen til ${target} på Boared, som du fik fra ${sender}. Vi kan se, at du endnu ikke har haft mulighed for at logge ind, og det er der slet ikke noget i vejen med.`;
  const ask = `Når du har et øjeblik, kan du åbne ${project ? "projektet" : "Boared"} via linket her:`;
  const signIn =
    'Log ind med denne e-mailadresse. Har du ingen adgangskode, kan du vælge "Magic link" på login-siden.';
  const help = `Har du spørgsmål, eller kan du ikke komme ind, er du meget velkommen til at kontakte ${sender}. Er invitationen ikke relevant for dig, kan du blot se bort fra mailen.`;
  const closing = "Tak for din tid og venlig hilsen";

  const text = [
    hello,
    "",
    intro,
    "",
    `${ask} ${input.url}`,
    "",
    signIn,
    "",
    help,
    "",
    closing,
    sender,
  ].join("\n");

  const href = escapeHtml(input.url);
  const html = [
    `<p>${escapeHtml(hello)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p>${escapeHtml(ask)}</p>`,
    `<p><a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:6px;` +
      `background:#111827;color:#ffffff;text-decoration:none;font-weight:600">` +
      `Åbn ${project ? "projektet" : "Boared"}</a></p>`,
    `<p>${escapeHtml(signIn)}</p>`,
    `<p>${escapeHtml(help)}</p>`,
    `<p>${escapeHtml(closing)}<br>${escapeHtml(sender)}</p>`,
    `<p style="color:#6b7280;font-size:12px">Eller indsæt dette link i din browser: ${href}</p>`,
  ].join("\n");

  return { subject, text, html };
}
