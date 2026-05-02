export interface PublicRate {
  label: string;
  ratePerHour: number | null;
  flatRate: number | null;
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
}

export type Urgency = "flexible" | "this-week" | "asap";
export type DurationGuess = "quick" | "hour" | "few-hours" | "unsure" | null;
