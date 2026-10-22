// src/features/admin/components/charts/series.ts
// Series colours for the admin charts, checked with the dataviz palette validator on white;
// re-run it before swapping a colour.

/** One plotted series: its name and the fill class for its bars and legend key. */
export interface ChartSeries {
  key: string;
  label: string;
  /** Background utility for the series' bars, legend swatch and tooltip key. */
  fillClass: string;
}

/**
 * Income vs expenses, labelled "(excl. GST)" while registered. Teal #009991 and violet
 * #5450e2 separate by ΔE 20.7 (deutan); moonstone reads as grey under the chroma floor.
 * @param gstRegistered - Whether the business is GST registered.
 * @returns The two series, income first.
 */
export function incomeExpenseSeries(gstRegistered: boolean): readonly ChartSeries[] {
  const suffix = gstRegistered ? " (excl. GST)" : "";
  return [
    { key: "income", label: `Income${suffix}`, fillClass: "bg-rich-black-700" },
    { key: "expenses", label: `Expenses${suffix}`, fillClass: "bg-russian-violet-400" },
  ];
}

/** Line colour for a stat-card sparkline: the de-emphasis grey, so only the end dot pops. */
export const SPARKLINE_LINE_CLASS = "text-seasalt-400";

/** End-dot colour for a sparkline: the income accent, marking the current month. */
export const SPARKLINE_DOT_CLASS = "bg-rich-black-700";

/** Each social app's series colour, the same swatches the Social calendar colours apps by. */
const APP_FILL = {
  facebook: { label: "Facebook", fillClass: "bg-moonstone-600" },
  instagram: { label: "Instagram", fillClass: "bg-russian-violet-400" },
  google: { label: "Google", fillClass: "bg-mustard-500" },
} as const;

/**
 * One series per social app, in the order given.
 * @param platforms - The apps.
 * @returns The series.
 */
export function appSeries(
  platforms: readonly ("facebook" | "instagram" | "google")[],
): readonly ChartSeries[] {
  return platforms.map((p) => ({ key: p, ...APP_FILL[p] }));
}
