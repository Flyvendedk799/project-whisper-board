import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { QueryState } from "@/components/query-state";
import { DataError } from "@/lib/errors";

/**
 * The failure branch is the reason this component exists: before it, all
 * eighteen queries rendered a failed fetch as an empty list, so "your request
 * was denied" and "you have no tickets" looked identical.
 */
const base = { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn() };

afterEach(cleanup);

describe("QueryState", () => {
  it("shows the pending state before anything has arrived", () => {
    renderWithQuery(
      <QueryState query={{ ...base, isPending: true }} pending={<p>Loading tickets</p>}>
        {() => <p>should not render</p>}
      </QueryState>,
    );
    expect(screen.getByText("Loading tickets")).toBeInTheDocument();
    expect(screen.queryByText("should not render")).not.toBeInTheDocument();
  });

  it("renders the data once it is there", () => {
    renderWithQuery(
      <QueryState query={{ ...base, data: ["a", "b"] }}>
        {(rows) => <p>{rows.length} tickets</p>}
      </QueryState>,
    );
    expect(screen.getByText("2 tickets")).toBeInTheDocument();
  });

  it("distinguishes an empty result from a failure", () => {
    renderWithQuery(
      <QueryState query={{ ...base, data: [] }} empty={<p>No tickets yet</p>}>
        {() => <p>rows</p>}
      </QueryState>,
    );
    expect(screen.getByText("No tickets yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a failure, and says what happened in words a client can read", () => {
    const denied = new DataError("tickets.list", {
      message: 'new row violates row-level security policy for table "tickets"',
      code: "42501",
    });

    renderWithQuery(
      <QueryState
        query={{ ...base, isError: true, error: denied }}
        errorTitle="Couldn't load tickets"
      >
        {() => <p>rows</p>}
      </QueryState>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load tickets");
    expect(alert).toHaveTextContent("You don't have access to that.");
    // The raw Postgres text must never reach the screen.
    expect(alert).not.toHaveTextContent("row-level security");
  });

  it("offers a retry that actually refetches", async () => {
    const refetch = vi.fn();
    renderWithQuery(
      <QueryState query={{ ...base, isError: true, error: new Error("boom"), refetch }}>
        {() => <p>rows</p>}
      </QueryState>,
    );

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
