// Step tones shared by the booking and invoice timelines.

/** Colour role of one timeline step. */
export type StepTone = "neutral" | "info" | "success" | "critical" | "violet";

/**
 * Dot colour for a step tone.
 * @param tone - Step tone.
 * @returns Background class.
 */
export function dotClass(tone: StepTone): string {
  switch (tone) {
    case "neutral":
      return "bg-admin-faint";
    case "info":
      return "bg-blue-500";
    case "success":
      return "bg-emerald-500";
    case "critical":
      return "bg-coquelicot-600";
    case "violet":
      return "bg-russian-violet";
  }
}
