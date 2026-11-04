/** Per-user light/dark preference (browser localStorage). */

function themeKey(username: string): string {
  return `scc_theme:${username.trim().toLowerCase()}`;
}

export function readUserTheme(username: string | null | undefined): boolean {
  if (!username || typeof username !== "string") return false;
  try {
    return window.localStorage.getItem(themeKey(username)) === "dark";
  } catch {
    return false;
  }
}

export function writeUserTheme(
  username: string | null | undefined,
  dark: boolean,
): void {
  if (!username || typeof username !== "string") return;
  try {
    window.localStorage.setItem(themeKey(username), dark ? "dark" : "light");
  } catch {
    /* ignore quota / private mode */
  }
}
