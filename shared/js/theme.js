/**
 * shared/js/theme.js
 * Re-usable theme persistence helpers.
 *
 * Usage — add before any page script:
 *   <script src="../shared/js/theme.js"></script>
 *
 * Both landing/landing.js and tool/tool.js duplicate these inline
 * for zero-dependency operation. This file is the canonical source
 * if you later refactor to ES modules or a bundler.
 */

"use strict";

/**
 * Read persisted theme from localStorage.
 * Falls back to OS prefers-color-scheme if no stored value.
 * @returns {boolean} true = dark, false = light
 */
function getStoredTheme() {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark")  return true;
    if (stored === "light") return false;
  } catch (_) { /* localStorage unavailable (private mode, etc.) */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Persist theme choice so it survives page navigation and refresh.
 * @param {boolean} dark
 */
function persistTheme(dark) {
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch (_) {}
}