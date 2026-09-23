import { describe, expect, it } from "vitest";
import { parsePullRequestUrl, parseRepoSlug, repoWebUrl } from "./github-url";
import { taskDescriptionFromTicket, ticketPriorityToTask } from "./ticket-task";

describe("github urls", () => {
  it("parses an owner/repo slug", () => {
    expect(parseRepoSlug(" Flyvendedk799/project-whisper-board ")).toEqual({
      owner: "Flyvendedk799",
      repo: "project-whisper-board",
    });
    expect(parseRepoSlug("not a repo")).toBeNull();
  });

  it("builds a web url and reads a pull request", () => {
    expect(repoWebUrl("boared/project-whisper-board")).toBe(
      "https://github.com/boared/project-whisper-board",
    );
    expect(parsePullRequestUrl("https://github.com/acme/app/pull/12")).toEqual({
      owner: "acme",
      repo: "app",
      number: 12,
    });
  });
});

describe("ticket to task", () => {
  it("maps urgent tickets onto critical tasks", () => {
    expect(ticketPriorityToTask("urgent")).toBe("critical");
    expect(ticketPriorityToTask("high")).toBe("high");
  });

  it("keeps the ticket number in the task description", () => {
    expect(
      taskDescriptionFromTicket({
        ticket_number: 14,
        type: "change_request",
        description: "Move the button.",
      }),
    ).toContain("#14");
  });
});
