import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Light, dark, or whatever the operating system says.
 *
 * The dark palette has been fully defined in styles.css since the beginning —
 * every token, both sidebars, all five chart colours — and was unreachable:
 * no provider, no toggle, and not one `dark:` class. This wires it up.
 *
 * The class must be on <html> before first paint or every load flashes white,
 * which is what THEME_SCRIPT is for.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "consflow-theme";

interface ThemeValue {
  theme: Theme;
  /** What is actually on screen once "system" is resolved. */
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/**
 * Runs before React hydrates, inline and blocking. Reading localStorage can
 * throw in a privacy-restricted context, so the whole thing is wrapped rather
 * than taking the page down with it.
 */
export const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
  var dark = stored === 'dark' ||
    ((!stored || stored === 'system') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
`.trim();

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Someone can change their OS theme while the tab is open.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing. The choice just will not survive a reload.
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      resolved,
      setTheme,
      // Toggling from "system" commits to the opposite of what is on screen,
      // which is what someone pressing the button is asking for.
      toggle: () => setTheme(resolved === "dark" ? "light" : "dark"),
    }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
