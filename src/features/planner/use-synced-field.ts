import { useEffect, useRef, useState } from "react";

/**
 * A text field that saves on blur and follows the server while you are not in
 * it. Realtime refetches therefore never overwrite what you are typing, and
 * an edit from an agent still shows up once you click away.
 */
export function useSyncedField(remote: string, commit: (value: string) => boolean | void) {
  const [value, setValue] = useState(remote);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setValue(remote);
  }, [remote]);

  return {
    value,
    setValue,
    bind: {
      value,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setValue(event.target.value),
      onFocus: () => {
        focused.current = true;
      },
      onBlur: () => {
        focused.current = false;
        // `false` means the edit was refused (an empty title): put the old text back.
        if (value === remote || commit(value) === false) setValue(remote);
      },
    },
  };
}
