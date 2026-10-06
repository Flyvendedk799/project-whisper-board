import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanDescription } from "./plan-header";

const KEY = "boared.plan.description.expanded";
const LONG = "A plan description that keeps going. ".repeat(10);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("PlanDescription", () => {
  it("has no toggle when the text is short", () => {
    render(<PlanDescription planId="p-1" text="Ship the beta." />);
    expect(screen.getByText("Ship the beta.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("collapses long text to two lines with a Show more button", () => {
    render(<PlanDescription planId="p-1" text={LONG} />);
    const button = screen.getByRole("button", { name: "Show more" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const text = document.getElementById(button.getAttribute("aria-controls")!);
    expect(text).toHaveClass("line-clamp-2");
  });

  it("treats several lines as long", () => {
    render(<PlanDescription planId="p-1" text={"Goal\nScope"} />);
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("expands and collapses, and remembers the choice per plan", async () => {
    const { unmount } = render(<PlanDescription planId="p-1" text={LONG} />);
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(less.getAttribute("aria-controls")!)).not.toHaveClass(
      "line-clamp-2",
    );
    expect(localStorage.getItem(`${KEY}.p-1`)).toBe("1");
    unmount();

    render(<PlanDescription planId="p-1" text={LONG} />);
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    cleanup();

    render(<PlanDescription planId="p-2" text={LONG} />);
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
    cleanup();

    render(<PlanDescription planId="p-1" text={LONG} />);
    await userEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(localStorage.getItem(`${KEY}.p-1`)).toBeNull();
  });
});
