import { describe, expect, it } from "vitest";
import { inviteAcceptPath, inviteEmail } from "./invite-email";

describe("inviteAcceptPath", () => {
  it("lands on the accept page, with the project when there is one", () => {
    expect(inviteAcceptPath()).toBe("/invite/accept");
    expect(inviteAcceptPath(null)).toBe("/invite/accept");
    expect(inviteAcceptPath("7c1f0d3e-0000-4000-8000-000000000001")).toBe(
      "/invite/accept?project=7c1f0d3e-0000-4000-8000-000000000001",
    );
  });
});

describe("inviteEmail", () => {
  const url = "https://boared.online/invite/accept?project=p1";

  it("names the inviter and the project, and links to the accept page", () => {
    const mail = inviteEmail({
      inviterName: "Tobias Mastek",
      workspaceName: "Mast3k Media",
      projectTitle: "Website relaunch",
      url,
    });
    expect(mail.subject).toBe(
      "Tobias Mastek invited you to Website relaunch (Mast3k Media) on Boared",
    );
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.html).toContain("Open the project");
  });

  it("names the workspace when there is no project", () => {
    const mail = inviteEmail({ inviterName: "Ana", workspaceName: "Acme", url });
    expect(mail.subject).toBe("Ana invited you to Acme on Boared");
    expect(mail.html).toContain("Open Boared");
  });

  it("reads sensibly with nothing but a link", () => {
    expect(inviteEmail({ url }).subject).toBe("Someone invited you to a workspace on Boared");
    expect(inviteEmail({ inviterName: "  ", url }).subject).toMatch(/^Someone /);
  });

  it("escapes names in the HTML part", () => {
    const mail = inviteEmail({
      inviterName: '<img src=x onerror="alert(1)">',
      workspaceName: "R&D",
      url: 'https://boared.online/invite/accept?a=1&b="2"',
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).toContain("R&amp;D");
    expect(mail.html).toContain(
      'href="https://boared.online/invite/accept?a=1&amp;b=&quot;2&quot;"',
    );
  });
});
