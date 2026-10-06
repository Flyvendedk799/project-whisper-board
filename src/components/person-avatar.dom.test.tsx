import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AvatarStack,
  PersonAvatar,
  PersonChip,
  personInitials,
  personName,
  safeAvatarUrl,
} from "./person-avatar";

afterEach(cleanup);

const ADA = {
  id: "u-1",
  full_name: "Ada King Lovelace",
  email: "ada@example.com",
  avatar_url: "https://cdn.test/ada.png",
};

describe("PersonAvatar", () => {
  it("shows the photo when there is one", () => {
    const { container } = render(<PersonAvatar person={ADA} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", ADA.avatar_url);
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(container).not.toHaveTextContent("AL");
  });

  it("falls back to initials when the photo fails to load", () => {
    const { container } = render(<PersonAvatar person={ADA} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("AL");
  });

  it("gives a new photo its own chance after an old one failed", () => {
    const { container, rerender } = render(<PersonAvatar person={ADA} />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<PersonAvatar person={{ ...ADA, avatar_url: "https://cdn.test/new.png" }} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.test/new.png");
  });

  it("uses initials when there is no photo or it is not a web URL", () => {
    const { container, rerender } = render(<PersonAvatar person={{ ...ADA, avatar_url: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("AL");
    rerender(<PersonAvatar person={{ ...ADA, avatar_url: "javascript:alert(1)" }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("is decorative unless given a label", () => {
    const { container, rerender } = render(<PersonAvatar person={ADA} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    rerender(<PersonAvatar person={ADA} label="Ada" />);
    expect(screen.getByRole("img", { name: "Ada" })).toBeInTheDocument();
  });

  it("marks a pending invite", () => {
    const { container } = render(<PersonAvatar person={ADA} pending />);
    expect(container.firstElementChild).toHaveAttribute("data-pending", "true");
  });
});

describe("PersonChip", () => {
  it("shows the name and a Pending badge for a pending invite", () => {
    render(<PersonChip person={ADA} pending />);
    expect(screen.getByText("Ada King Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("has no badge once someone has joined, and a fallback for nobody", () => {
    const { rerender } = render(<PersonChip person={ADA} />);
    expect(screen.queryByText("Pending")).toBeNull();
    rerender(<PersonChip person={null} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});

describe("AvatarStack", () => {
  it("shows a few faces and counts the rest", () => {
    const people = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo"].map((name, i) => ({
      id: `u-${i}`,
      full_name: name,
    }));
    render(<AvatarStack people={people} max={4} />);
    expect(screen.getByRole("img", { name: "Ann, Bo, Cy, Di, Ed, Flo" })).toHaveTextContent("+2");
  });
});

describe("helpers", () => {
  it("personInitials takes first and last name, or the email, or ?", () => {
    expect(personInitials(ADA)).toBe("AL");
    expect(personInitials({ full_name: "  cher " })).toBe("C");
    expect(personInitials({ email: "zed@x.io" })).toBe("Z");
    expect(personInitials(null)).toBe("?");
  });

  it("personName prefers the name, then the email, then the fallback", () => {
    expect(personName({ full_name: " ", email: "a@b.c" })).toBe("a@b.c");
    expect(personName(undefined, "Nobody")).toBe("Nobody");
  });

  it("safeAvatarUrl only allows http(s)", () => {
    expect(safeAvatarUrl(" https://x.test/a.png ")).toBe("https://x.test/a.png");
    expect(safeAvatarUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeAvatarUrl("//x.test/a.png")).toBeNull();
    expect(safeAvatarUrl(null)).toBeNull();
  });
});
