// src/features/admin/components/charts/series.ts
// Series colours for the admin charts. Each pair is checked with the dataviz palette
// validator against the white admin surface (lightness band, chroma floor, colour-blind
// separation, 3:1 contrast); re-run it before swapping a colour.

/** One plotted series: its name and the fill class for its bars and legend key. */
export interface ChartSeries {
  key: string;
  label: string;
  /** Background utility for the series' bars, legend swatch and tooltip key. */
  fillClass: string;
}

/**
 * Income vs expenses. Teal rich-black-700 (#009991) and violet russian-violet-400
 * (#5450e2): worst colour-blind separation ΔE 20.7 (deutan), both above 3:1 on white.
 * Moonstone was rejected: its 600 step sits under the chroma floor and reads as grey.
 */
export const INCOME_EXPENSE_SERIES: readonly ChartSeries[] = [
  { key: "income", label: "Income", fillClass: "bg-rich-black-700" },
  { key: "expenses", label: "Expenses (excl. GST)", fillClass: "bg-russian-violet-400" },
];

/** Line colour for a stat-card sparkline: the de-emphasis grey, so only the end dot pops. */
export const SPARKLINE_LINE_CLASS = "text-seasalt-400";

/** End-dot colour for a sparkline: the income accent, marking the current month. */
export const SPARKLINE_DOT_CLASS = "bg-rich-black-700";
