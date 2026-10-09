import { describe, expect, it } from "vitest";
import { followUpEmail } from "./followup-email";

describe("followUpEmail", () => {
  const url = "https://boared.online/app/projects/p1?invite_prompt=true";

  it("greets by first name, names the project and sender, and links to it", () => {
    const mail = followUpEmail({
      senderName: "Tobias Mastek",
      recipientName: "Maja Jensen",
      workspaceName: "Mast3k Media",
      projectTitle: "Website relaunch",
      url,
    });
    expect(mail.subject).toBe("Opfølgning på din invitation til Website relaunch (Mast3k Media)");
    expect(mail.text.startsWith("Hej Maja,")).toBe(true);
    expect(mail.text).toContain("Tobias Mastek");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.html).toContain("Åbn projektet");
  });

  it("falls back gracefully with no names", () => {
    const mail = followUpEmail({ url });
    expect(mail.subject).toBe("Opfølgning på din invitation til Boared");
    expect(mail.text.startsWith("Hej,")).toBe(true);
    expect(mail.text).toContain("teamet");
    expect(mail.html).toContain("Åbn Boared");
  });

  it("does not greet an email address as if it were a name", () => {
    const mail = followUpEmail({ recipientName: "maja@example.com", url });
    expect(mail.text.startsWith("Hej,")).toBe(true);
  });

  it("escapes names and the link in the HTML part", () => {
    const mail = followUpEmail({
      senderName: '<img src=x onerror="alert(1)">',
      recipientName: "<b>Eve</b>",
      workspaceName: "R&D",
      url: 'https://boared.online/app?a=1&b="2"',
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain("R&amp;D");
    expect(mail.html).toContain('href="https://boared.online/app?a=1&amp;b=&quot;2&quot;"');
  });
});
