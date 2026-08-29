import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { SectionBoundary } from "@/components/error-boundary";

function Boom({ throws }: { throws: boolean }): React.ReactElement {
  if (throws) throw new Error("the chart exploded");
  return <p>recovered</p>;
}

beforeEach(() => {
  // React logs the caught error; that noise is not the test's business.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("SectionBoundary", () => {
  it("renders its children when nothing is wrong", () => {
    renderWithQuery(
      <SectionBoundary label="chart">
        <Boom throws={false} />
      </SectionBoundary>,
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("catches a render failure and keeps the rest of the page alive", () => {
    renderWithQuery(
      <div>
        <p>the rest of the page</p>
        <SectionBoundary label="chart">
          <Boom throws />
        </SectionBoundary>
      </div>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The point of a section boundary rather than a root one.
    expect(screen.getByText("the rest of the page")).toBeInTheDocument();
  });

  it("does not show the raw error message to whoever is looking", () => {
    renderWithQuery(
      <SectionBoundary label="chart">
        <Boom throws />
      </SectionBoundary>,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("the chart exploded");
  });

  it("lets you try again", async () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("first time only");
      return <p>recovered</p>;
    }

    renderWithQuery(
      <SectionBoundary label="chart">
        <Flaky />
      </SectionBoundary>,
    );

    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
