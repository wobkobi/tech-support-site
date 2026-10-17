// src/features/social-design/components/canvas/fonts.ts
// Exo for the canvas. next/font serves it under a hashed family name exposed as the
// --font-exo variable, and the browser only fetches a weight (and the latin-ext file
// holding te reo macrons) once some text asks for it. The canvas measures text the
// moment it draws, so every weight is loaded up front with sample macrons.

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
