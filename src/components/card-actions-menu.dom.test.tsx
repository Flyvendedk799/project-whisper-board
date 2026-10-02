import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CopyIdButton } from "@/features/planner/copy-id-button";
import { CardActionsMenu, CardCorner } from "./card-actions-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const noop = () => {};
const menuProps = {
  label: "Roadmap",
  archived: false,
  onArchive: noop,
  onRestore: noop,
  onDelete: noop,
};

describe("CardActionsMenu", () => {
  it("positions itself over the card's corner when it is the only control", () => {
    render(<CardActionsMenu {...menuProps} />);
    expect(screen.getByLabelText("Actions for Roadmap").className).toContain("absolute");
  });

  it("leaves the positioning to a CardCorner when inline", () => {
    render(<CardActionsMenu {...menuProps} inline />);
    expect(screen.getByLabelText("Actions for Roadmap").className).not.toContain("absolute");
  });
});

describe("CardCorner", () => {
  it("holds the copy button and the menu side by side, so they cannot overlap", () => {
    render(
      <CardCorner>
        <CopyIdButton id="3f2a9c10-aaaa-bbbb-cccc-1234567890ab" label="plan" />
        <CardActionsMenu {...menuProps} inline />
      </CardCorner>,
    );
    const copy = screen.getByLabelText("Copy plan id");
    const menu = screen.getByLabelText("Actions for Roadmap");
    expect(copy.parentElement).toBe(menu.parentElement);
    expect(copy.parentElement?.className).toMatch(/\bflex\b/);
    expect(copy.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
