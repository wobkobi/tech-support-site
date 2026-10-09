// src/app/api/business/tax-years/[fyKey]/route.ts
// Admin per-FY tax record endpoint. PUT upserts the TaxYear row for one FY key: the home
// office floor areas and whole-house costs, that year's IRD square-metre and kilometre
// rates, and the car's total km for the year. A filed year is refused so its figures stay
// frozen. POST `{ action: "file" | "unfile" }` saves the year's figures as a snapshot or
// releases them.

import { fileTaxYear, unfileTaxYear } from "@/features/business/lib/tax/filing.server";
import { resolveFinancialYear } from "@/features/business/lib/tax/view.server";
import { parseAmount } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { Prisma, type TaxYear } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

/** Shown for a malformed key, or one outside the business start to the current FY. */
const UNKNOWN_FY_ERROR = "Unknown financial year";

/** TaxYear fields this route writes. Null clears a value (rates then fall back to IRD's). */
const EDITABLE_FIELDS = [
  "officeSqm",
  "houseSqm",
  "sqmRate",
  "kmTier1",
  "kmTier2",
  "totalVehicleKm",
  "mortgageInterestOrRent",
  "rates",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Shown for a zero, negative or non-numeric total km. */
const TOTAL_KM_ERROR = "Enter the car's total km, or leave it blank.";

/**
 * Marks a response as never cacheable: it reflects a record that changes on every save.
 * @param res - Response to mark.
 * @returns The same response.
 */
function noStore<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Whether an error is Prisma's unique-constraint violation (P2002).
 * @param err - Caught error.
 * @returns True for P2002.
 */
function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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
  // A malformed key, or one outside the business start to the current FY, has no year to
  // record; POST answers it the same way.
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
    return noStore(errorResponse("Invalid body", 400));
  }
  const raw = body as Record<string, unknown>;

  // Sparse update: only fields present in the body get written; null or "" clears one.
  // Booleans and objects are refused outright, since Number(true) would read as 1.
  // Total km must be above 0: a 0 would hide the Trips page's "enter the total" hint
  // and skew the Tier 1 split, so blank is the way to say "not known".
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
    if (parsed === null) {
      return noStore(errorResponse(`Invalid ${field}`, 400));
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
      errorResponse("This year is filed. Unfile it on the Tax page before changing it.", 409),
    );
  }

  // Check the areas as they will be after the save, so a one-field update can't
  // leave the office bigger than the house.
  const office = data.officeSqm !== undefined ? data.officeSqm : (existing?.officeSqm ?? null);
  const house = data.houseSqm !== undefined ? data.houseSqm : (existing?.houseSqm ?? null);
  if (office !== null && house !== null && office > house) {
    return noStore(errorResponse("The office can't be bigger than the house.", 400));
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
    // Two first saves for one FY can both take the create path; the loser hits the
    // fyKey unique index (P2002). Retry once: the row now exists, so it updates.
    if (!isUniqueConflict(err)) throw err;
    taxYear = await upsert();
  }
  return noStore(NextResponse.json({ ok: true, taxYear }));
}

/**
 * POST /api/business/tax-years/[fyKey] - Marks a financial year filed or unfiled.
 * `{ action: "file" }` saves the year's live figures as TaxYear.snapshot and stamps
 * filedAt; `{ action: "unfile" }` clears both, so the year goes back to live figures.
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
  // Check the key before the body, as PUT does, so a bad key gets the same answer on both.
  if (!(await resolveFinancialYear(fyKey, new Date()))) {
    return noStore(errorResponse(UNKNOWN_FY_ERROR, 404));
  }
  const body: unknown = await request.json().catch(() => null);
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
