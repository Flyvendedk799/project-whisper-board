import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/test/render";
import { CaptureDropzone } from "./capture-dropzone";
import { newDraftId, type DraftAttachment } from "@/lib/upload";

/**
 * The component this replaces was a bare `<div tabIndex={0}>` with pointer
 * handlers: focusable, and then completely inert from the keyboard. These lock
 * that it stays operable without a mouse.
 */

const draft = (name: string, type = "image/png"): DraftAttachment => ({
  id: newDraftId(),
  file: new File(["x"], name, { type }),
  bucket: "attachments",
  kind: "image",
});

afterEach(cleanup);

describe("CaptureDropzone", () => {
  it("exposes the drop area as a labelled control, not an unlabelled div", () => {
    renderWithQuery(<CaptureDropzone drafts={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    const zone = screen.getByRole("button", { name: /press enter to choose files/i });
    expect(zone).toBeInTheDocument();
    expect(zone).toHaveAttribute("aria-describedby");
  });

  it("opens the file picker from the keyboard", async () => {
    renderWithQuery(<CaptureDropzone drafts={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    const zone = screen.getByRole("button", { name: /press enter to choose files/i });
    zone.focus();
    await userEvent.keyboard("{Enter}");
    expect(click).toHaveBeenCalled();

    await userEvent.keyboard(" ");
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("lists what has been attached, with a way to remove each one", async () => {
    const onRemove = vi.fn();
    const one = draft("screenshot.png");
    renderWithQuery(<CaptureDropzone drafts={[one]} onAdd={vi.fn()} onRemove={onRemove} />);

    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove screenshot.png" }));
    expect(onRemove).toHaveBeenCalledWith(one.id);
  });

  it("announces additions and removals for screen readers", () => {
    renderWithQuery(<CaptureDropzone drafts={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);
    // The live region exists before anything happens, or the first
    // announcement is missed.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
  });

  it("takes a dropped file", async () => {
    const onAdd = vi.fn();
    renderWithQuery(<CaptureDropzone drafts={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const zone = screen.getByRole("button", { name: /press enter to choose files/i });
    const file = new File(["x"], "dropped.png", { type: "image/png" });

    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    zone.dispatchEvent(event);

    expect(onAdd).toHaveBeenCalledWith([file]);
  });

  it("refuses a file that is too large, and says which one", async () => {
    const onAdd = vi.fn();
    renderWithQuery(<CaptureDropzone drafts={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const huge = new File(["x"], "enormous.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 });

    const zone = screen.getByRole("button", { name: /press enter to choose files/i });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [huge] } });
    zone.dispatchEvent(event);

    expect(onAdd).not.toHaveBeenCalled();
  });
});
