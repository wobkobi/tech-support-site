// src/features/social-design/components/canvas/fonts.ts
// Exo for the canvas. The browser fetches a weight (and the latin-ext macron file) only on first
// use, but the canvas measures text as it draws, so every weight loads up front with macrons.

const WEIGHTS = [400, 500, 600, 700, 800];
const SAMPLE = "Aa āēīōū ĀĒĪŌŪ";

/**
 * The CSS font-family list next/font gives Exo.
 * @returns Family list, or a plain fallback outside the app.
 */
export function exoFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-exo").trim();
  return value || "Exo, sans-serif";
}

/**
 * Loads every Exo weight the presets use, macrons included.
 * @param family - Font-family list from {@link exoFamily}.
 */
export async function loadExo(family: string): Promise<void> {
  await Promise.all(
    WEIGHTS.flatMap((w) => [
      document.fonts.load(`${w} 40px ${family}`, SAMPLE),
      document.fonts.load(`italic ${w} 40px ${family}`, SAMPLE),
    ]),
  );
}
