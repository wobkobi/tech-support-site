// src/app/api/business/tax-years/[fyKey]/route.ts
// Admin per-FY tax record endpoint. PUT upserts one FY's TaxYear row (refused once filed);
// POST `{ action: "file" | "unfile" }` snapshots or releases the year's figures.

import { fileTaxYear, unfileTaxYear } from "@/features/business/lib/tax/filing.server";
import { resolveFinancialYear } from "@/features/business/lib/tax/view.server";
import { parseAmount } from "@/features/business/lib/validation";
import { errorResponse, isUniqueConflict, noStore } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { TaxYear } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/** Shown for a malformed key, or one outside the business start to the current FY. */
const UNKNOWN_FY_ERROR = "Unknown financial year";

/** TaxYear fields this route writes. Null clears a value back to the IRD/Settings default. */
const EDITABLE_FIELDS = [
  "officeSqm",
  "houseSqm",
  "sqmRate",
  "kmTier1",
  "kmTier2",
  "totalVehicleKm",
  "accRate",
  "mortgageInterestOrRent",
  "rates",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Each field as the Tax page's year form names it, so a refusal points at the right input. */
const FIELD_LABELS: Record<EditableField, string> = {
  officeSqm: "office floor area",
  houseSqm: "whole house floor area",
  sqmRate: "square-metre rate",
  kmTier1: "Tier 1 kilometre rate",
  kmTier2: "Tier 2 kilometre rate",
  totalVehicleKm: "total km the car travelled",
  accRate: "ACC levy rate",
  mortgageInterestOrRent: "mortgage interest or rent",
  rates: "council rates",
};

/** Shown for a zero, negative or non-numeric total km. */
const TOTAL_KM_ERROR = "Enter the car's total km, or leave it blank";

/** Highest ACC rate fraction accepted; the levy is under 2%, so more is a typed percent. */
const MAX_ACC_RATE = 0.2;

/**
 * PUT /api/business/tax-years/[fyKey] - Creates or updates one FY's TaxYear record.
 * @param request - Incoming request; JSON body with any of the editable fields.
 * @param root0 - Route context.
 * @param root0.params - Route params promise carrying the FY key.
 * @returns JSON with the saved record, or an error.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ fyKey: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }

  const { fyKey } = await params;
  // A malformed or out-of-range key has no year to record.
  if (!(await resolveFinancialYear(fyKey, new Date()))) {
    return noStore(errorResponse(UNKNOWN_FY_ERROR, 404));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(errorResponse("Invalid JSON body", 400));
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return noStore(errorResponse("Expected a JSON object", 400));
  }
  const raw = body as Record<string, unknown>;

  // Sparse update; null or "" clears a field. Booleans are refused (Number(true) is 1).
  // Total km must be above 0 - blank means "not known", 0 would skew the Tier 1 split.
  const data: Partial<Record<EditableField, number | null>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (value === null || value === "") {
      data[field] = null;
      continue;
    }
    const parsed =
      typeof value === "number" || typeof value === "string" ? parseAmount(value) : null;
    if (field === "totalVehicleKm" && (parsed === null || parsed === 0)) {
      return noStore(errorResponse(TOTAL_KM_ERROR, 400));
    }
    if (parsed === null || (field === "accRate" && parsed > MAX_ACC_RATE)) {
      return noStore(errorResponse(`Invalid ${FIELD_LABELS[field]}`, 400));
    }
    data[field] = parsed;
  }
  if (Object.keys(data).length === 0) {
    return noStore(errorResponse("Nothing to update", 400));
  }

  const existing = await prisma.taxYear.findUnique({
    where: { fyKey },
    select: { filedAt: true, officeSqm: true, houseSqm: true },
  });
  if (existing?.filedAt) {
    return noStore(
      errorResponse("This year is filed, so unfile it on the Tax page before changing it", 409),
    );
  }

  // Check the post-save areas so a one-field update can't make office > house.
  const office = data.officeSqm !== undefined ? data.officeSqm : (existing?.officeSqm ?? null);
  const house = data.houseSqm !== undefined ? data.houseSqm : (existing?.houseSqm ?? null);
  if (office !== null && house !== null && office > house) {
    return noStore(errorResponse("The office can't be bigger than the house", 400));
  }

  /**
   * Creates the FY's row, or updates it when it exists.
   * @returns The saved row.
   */
  const upsert = (): Promise<TaxYear> =>
    prisma.taxYear.upsert({ where: { fyKey }, update: data, create: { fyKey, ...data } });
  let taxYear: TaxYear;
  try {
    taxYear = await upsert();
  } catch (err) {
    // Two first saves can both create; retry the P2002 loser once as an update.
    if (!isUniqueConflict(err)) throw err;
    taxYear = await upsert();
  }
  return noStore(NextResponse.json({ ok: true, taxYear }));
}

/**
 * POST /api/business/tax-years/[fyKey] - Marks a financial year filed or unfiled.
 * "file" saves TaxYear.snapshot and stamps filedAt; "unfile" clears both.
 * @param request - Incoming request with `{ action }` in the body.
 * @param root0 - Route context.
 * @param root0.params - Route params promise carrying the FY key ("2025-26").
 * @returns JSON `{ ok: true, filedAt }`, or `{ ok: false, error }` with 400/401/404/409.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fyKey: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return noStore(errorResponse("Unauthorized", 401));

  const { fyKey } = await params;
  // Check the key before the body, matching PUT.
  if (!(await resolveFinancialYear(fyKey, new Date()))) {
    return noStore(errorResponse(UNKNOWN_FY_ERROR, 404));
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(errorResponse("Invalid JSON body", 400));
  }
  const action =
    typeof body === "object" && body !== null ? (body as { action?: unknown }).action : undefined;
  if (action !== "file" && action !== "unfile") {
    return noStore(errorResponse('action must be "file" or "unfile"', 400));
  }

  const now = new Date();
  const outcome =
    action === "file" ? await fileTaxYear(fyKey, now) : await unfileTaxYear(fyKey, now);
  if (!outcome.ok) return noStore(errorResponse(outcome.error, outcome.status));
  return noStore(NextResponse.json({ ok: true, filedAt: outcome.filedAt }));
}
