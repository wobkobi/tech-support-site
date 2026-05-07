export interface RateConfig {
  id: string;
  label: string;
  ratePerHour: number | null;
  flatRate: number | null;
  unit: string;
  isDefault: boolean;
  createdAt: string;
}

export interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID";

export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  gst: boolean;
  subtotal: number;
  gstAmount: number;
  total: number;
  status: InvoiceStatus;
  notes: string | null;
  contactId: string | null;
  driveFileId: string | null;
  driveWebUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncomeEntry {
  id: string;
  date: string;
  customer: string;
  description: string;
  amount: number;
  method: string;
  notes: string | null;
  invoiceId: string | null;
  createdAt: string;
}

export interface ExpenseEntry {
  id: string;
  date: string;
  supplier: string;
  description: string;
  category: string;
  amountIncl: number;
  gstAmount: number;
  amountExcl: number;
  method: string;
  receipt: boolean;
  notes: string | null;
  createdAt: string;
}

export interface BusinessSummary {
  totalIncome: number;
  totalExpensesExcl: number;
  totalGstClaimable: number;
  taxReserve: number;
  profit: number;
  currentMonthIncome: number;
  currentMonthExpenses: number;
  incomeCount: number;
  expenseCount: number;
}

export interface GoogleContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
}

export interface TaskLine {
  rateConfigId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PartLine {
  description: string;
  cost: number;
}

export interface JobCalculation {
  startTime: string;
  endTime: string;
  durationMins: number;
  hourlyRate: RateConfig | null;
  tasks: TaskLine[];
  parts: PartLine[];
  travelCost: number | null;
  notes: string;
  gst: boolean;
  clientName: string;
  clientEmail: string;
}

export interface ParseJobRequest {
  input: string;
  answers?: Record<string, string>;
}

export interface ParseJobQuestion {
  id: string;
  question: string;
  hint?: string;
}

export interface ParseJobResponse {
  durationMins: number | null;
  startTime: string | null;
  endTime: string | null;
  hourlyRateId: string | null;
  tasks: ParsedTaskLine[];
  parts: ParsedPartLine[];
  notes: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  destination: string | null;
  statedDistanceKm: number | null;
  noTravelCharge: boolean;
  travel?: TravelInfo;
}

export interface ParsedTaskLine {
  rateConfigId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
}

export interface ParsedPartLine {
  description: string;
  cost: number;
}

export interface TaskTemplate {
  id: string;
  description: string;
  defaultPrice: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  description: string;
  supplier: string;
  category: string;
  amountIncl: number;
  gstRate: number;
  method: string;
  frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annually";
  nextDue: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SheetCounterResponse {
  lastNumber: number;
  nextNumber: number;
  yearCode: string;
  nextFormatted: string;
  prefix: string;
}
export interface ParsedTaskLine {
  rateConfigId: string | null;
  description: string;
  qty: number; // hours for work, km for travel
  unitPrice: number;
}

// Add this new interface
export interface TravelInfo {
  distanceKm: number;
  durationMins: number;
  destination?: string;
}
