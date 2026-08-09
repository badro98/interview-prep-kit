// Global (not job-scoped) light/dark theme. Persisted via raw store get/set.

import { get, set } from "./store.js";

export const THEME_LIGHT = "light";
export const THEME_DARK = "dark";

const THEME_KEY = "settings:theme";

/** Current theme. Defaults to light (LinkedIn-style). */
export function getTheme() {
  return get(THEME_KEY, THEME_LIGHT) === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

/** Persist theme and sync the document attribute. */
export function setTheme(theme) {
  const next = theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  set(THEME_KEY, next);
  applyTheme(next);
  return next;
}

/** Apply theme to <html data-theme> without persisting. */
export function applyTheme(theme = getTheme()) {
  const next = theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  document.documentElement.dataset.theme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === THEME_DARK ? "#1B1A18" : "#F4F2EE");
}
