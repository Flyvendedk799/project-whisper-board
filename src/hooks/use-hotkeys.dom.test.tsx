import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useHotkeys, type Bindings } from "@/lib/use-hotkeys";

function Harness({ bindings, enabled = true }: { bindings: Bindings; enabled?: boolean }) {
  useHotkeys(bindings, { enabled });
  return (
    <div>
      <input aria-label="a text field" />
      <textarea aria-label="a text area" />
      <button type="button">a button</button>
    </div>
  );
}

afterEach(cleanup);

describe("useHotkeys", () => {
  it("fires a single-key binding", async () => {
    const onCreate = vi.fn();
    render(<Harness bindings={{ c: onCreate }} />);

    await userEvent.keyboard("c");
    expect(onCreate).toHaveBeenCalledOnce();
  });

  /**
   * The rule that matters most: a shortcut firing while someone types a message
   * is worse than having no shortcut at all.
   */
  it("stays out of the way while someone is typing", async () => {
    const onCreate = vi.fn();
    const { getByLabelText } = render(<Harness bindings={{ c: onCreate }} />);

    await userEvent.click(getByLabelText("a text field"));
    await userEvent.keyboard("c");
    expect(onCreate).not.toHaveBeenCalled();

    await userEvent.click(getByLabelText("a text area"));
    await userEvent.keyboard("c");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("still allows the palette and Escape while typing", async () => {
    const onPalette = vi.fn();
    const onEscape = vi.fn();
    const { getByLabelText } = render(
      <Harness bindings={{ "mod+k": onPalette, Escape: onEscape }} />,
    );

    await userEvent.click(getByLabelText("a text field"));
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.keyboard("{Escape}");

    expect(onPalette).toHaveBeenCalledOnce();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("resolves a two-key chord", async () => {
    const goTriage = vi.fn();
    render(<Harness bindings={{ "g t": goTriage }} />);

    await userEvent.keyboard("gt");
    expect(goTriage).toHaveBeenCalledOnce();
  });

  it("does not let a chord prefix swallow an unrelated key", async () => {
    const goTriage = vi.fn();
    const onComment = vi.fn();
    render(<Harness bindings={{ "g t": goTriage, c: onComment }} />);

    // "g" arms the chord; "c" is not part of one, so it acts on its own.
    await userEvent.keyboard("gc");
    expect(goTriage).not.toHaveBeenCalled();
    expect(onComment).toHaveBeenCalledOnce();
  });

  it("can be suspended, e.g. while a dialog owns the keyboard", async () => {
    const onCreate = vi.fn();
    render(<Harness bindings={{ c: onCreate }} enabled={false} />);

    await userEvent.keyboard("c");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", async () => {
    const onCreate = vi.fn();
    const { unmount } = render(<Harness bindings={{ c: onCreate }} />);
    unmount();

    await userEvent.keyboard("c");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
