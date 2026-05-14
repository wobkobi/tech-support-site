export interface PublicRate {
  label: string;
  ratePerHour: number | null;
  flatRate: number | null;
  /** Signed delta added to the base hourly rate when applied (modifier rates only). */
  hourlyDelta: number | null;
  unit: string;
  isDefault: boolean;
}

export interface SelectedService {
  label: string;
  type: "flat" | "hourly";
  flatRate: number | null;
  ratePerHour: number | null;
}

export interface BreakdownLine {
  label: string;
  low: number;
  high: number;
  note: string | null;
}

export interface PriceRange {
  low: number;
  high: number;
  breakdown: BreakdownLine[];
  includesTravel: boolean;
  includesAfterHours: boolean;
  /** Pre-promo range, populated only when an active promo discounted the headline. */
  originalLow?: number;
  originalHigh?: number;
  /** Customer-facing label of the active promo, when applied. */
  promoLabel?: string;
}

export type Urgency = "flexible" | "this-week" | "asap";
export type DurationGuess = "quick" | "hour" | "few-hours" | "unsure" | null;
