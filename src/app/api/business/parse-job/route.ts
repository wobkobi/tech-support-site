import { composeDescription, effectiveHourlyRate } from "@/features/business/lib/business";
import { floorBillableMins } from "@/features/business/lib/pricing-policy";
import {
  buildParseJobContext,
  buildParseJobPrompt,
} from "@/features/business/lib/prompts/parse-job";
import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import type {
  ParseJobQuestion,
  ParseJobResponse,
  ParsedRange,
  RateConfig,
} from "@/features/business/types/business";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/** Internal extension that carries the per-range duration (used by the pre-compute hint). */
interface RangeWithDuration extends ParsedRange {
  durationMins: number;
}

const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;

type Meridiem = "am" | "pm" | null;

/**
 * Extracts the am/pm marker from a time fragment.
 * @param s - Time fragment like "7", "9pm", "10:30am".
 * @returns "am" / "pm" / null.
 */
function meridiemOf(s: string): Meridiem {
  const t = s.toLowerCase();
  if (/pm/.test(t)) return "pm";
  if (/am/.test(t)) return "am";
  return null;
}

/**
 * Parses a time string into minutes since midnight.
 * @param s - Time string (e.g. "7pm", "7:10", "10:22am").
 * @param assume - Meridiem to apply when the string has none (e.g. trailing "pm" in "7-9pm").
 * @returns Minutes since midnight, or null if unparseable.
 */
function parseTimeMins(s: string, assume: Meridiem = null): number | null {
  const t = s.trim().toLowerCase();
  const meridiem: Meridiem = meridiemOf(t) ?? assume;
  const clean = t.replace(/[apm\s]/g, "");
  const [hStr, mStr = "0"] = clean.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  if (meridiem === "pm") return (h === 12 ? 12 : h + 12) * 60 + m;
  if (meridiem === "am") return (h === 12 ? 0 : h) * 60 + m;
  return h * 60 + m;
}

/**
 * Formats minutes-since-midnight as a HH:MM string. Wraps at 24h boundaries
 * so a "11pm-1am" overnight range still serialises cleanly.
 * @param mins - Minutes since midnight (may exceed 1440 for cross-midnight ends).
 * @returns HH:MM string.
 */
function minsToHHMM(mins: number): string {
  const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Extracts every HH:MM-HH:MM segment found on digit-led lines. Used internally
 * to compute the worked-minutes hint passed to the AI as a "pre-computed
 * session total" annotation.
 * @param input - Raw job description text.
 * @returns Array of parsed time ranges (may be empty when nothing detected).
 */
function extractRanges(input: string): RangeWithDuration[] {
  const ranges: RangeWithDuration[] = [];
  for (const line of input.split("\n")) {
    if (!/^\d/.test(line.trim())) continue;
    TIME_RANGE_RE.lastIndex = 0;
    const m = TIME_RANGE_RE.exec(line);
    if (!m) continue;
    const startMeridiem = meridiemOf(m[1]);
    const endMeridiem = meridiemOf(m[2]);
    const start = parseTimeMins(m[1], startMeridiem ?? endMeridiem);
    const end = parseTimeMins(m[2], endMeridiem ?? startMeridiem);
    if (start === null || end === null) continue;
    let endResolved = end;
    let dur = end - start;
    if (dur <= 0) {
      const withNoon = dur + 12 * 60;
      if (withNoon > 0 && withNoon <= 16 * 60) {
        endResolved = end + 12 * 60;
        dur = withNoon;
      } else {
        endResolved = end + 24 * 60;
        dur = dur + 24 * 60;
      }
    }
    ranges.push({
      startTime: minsToHHMM(start),
      endTime: minsToHHMM(endResolved),
      durationMins: dur,
    });
  }
  return ranges;
}

/**
 * Sums all HH:MM-HH:MM segments on lines that start with a digit. Feeds the
 * AI pre-compute hint so the model uses the operator-stated minutes verbatim.
 * @param input - Raw job description text.
 * @returns Total worked minutes, or null if no time ranges detected.
 */
function calcSessionMins(input: string): number | null {
  const ranges = extractRanges(input);
  if (ranges.length === 0) return null;
  return ranges.reduce((s, x) => s + x.durationMins, 0);
}

/**
 * Snaps AI device/action tags to the canonical template by exact match.
 * @param device - Device tag from the AI.
 * @param action - Action tag from the AI.
 * @param templates - All saved templates.
 * @returns Matching template or null.
 */
function findTemplateByTags<T extends { device: string | null; action: string | null }>(
  device: string | null | undefined,
  action: string | null | undefined,
  templates: T[],
): T | null {
  if (!device || !action) return null;
  const dLower = device.toLowerCase();
  const aLower = action.toLowerCase();
  return (
    templates.find(
      (t) => (t.device ?? "").toLowerCase() === dLower && (t.action ?? "").toLowerCase() === aLower,
    ) ?? null
  );
}

/**
 * POST /api/business/parse-job - Parses a plain-English job description using gpt-4.1.
 * Pre-computes session total from time ranges and attaches travel info from the AI-extracted destination.
 * @param request - Incoming Next.js request with input string in body
 * @returns JSON with structured ParseJobResponse or a 422 error
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse and validate body
  const body = await request.json();
  const { input, answers } = body as { input: unknown; answers?: Record<string, unknown> };

  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }
  if (input.length > 1000) {
    return NextResponse.json({ error: "input must be 1000 characters or fewer" }, { status: 400 });
  }

  // Whitelist the clarification answer keys to the IDs the model is allowed to
  // ask about (see the CLARIFICATION MODE block in the system prompt). Anything
  // else is dropped on the floor so a crafted payload can't smuggle synthetic
  // "[User clarifications: ...]" annotations into the trusted segment.
  const ALLOWED_ANSWER_KEYS = new Set(["location", "duration", "tasks"]);
  const safeAnswers: Record<string, string> = {};
  if (answers && typeof answers === "object") {
    for (const [k, v] of Object.entries(answers)) {
      if (!ALLOWED_ANSWER_KEYS.has(k)) continue;
      if (typeof v !== "string") continue;
      const clean = v.trim().slice(0, 200);
      if (clean) safeAnswers[k] = clean;
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Load rates, templates and settings
    const [rates, templates, settings] = await Promise.all([
      prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
      prisma.taskTemplate.findMany({ orderBy: [{ usageCount: "desc" }, { description: "asc" }] }),
      getSettings(),
    ]);
    const { company, name, location } = settings.identity;

    const rateDtos = rates.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    const templateDtos = templates.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));

    const currentTime = new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());

    // System prompt is static (cacheable) - all per-call data is appended to
    // the user message via buildParseJobContext.
    const systemPrompt = buildParseJobPrompt();
    const context = buildParseJobContext(
      rateDtos,
      templateDtos,
      currentTime,
      { company, name, location },
      {
        minBillableMins: settings.pricing.minBillableMins,
        incrementMins: settings.pricing.billingIncrementMins,
      },
    );

    const precomputed = calcSessionMins(input);
    // Close the untrusted USER DATA block before any server-supplied trusted
    // annotations so the model knows where operator-controlled text ends.
    let userContent = `${context}${input.trim()}\n--- END USER DATA ---`;
    if (precomputed !== null) {
      userContent += `\n\n[Pre-computed session total: ${precomputed} min — use this as durationMins without recalculating]`;
    }
    if (Object.keys(safeAnswers).length > 0) {
      const clarifications = Object.entries(safeAnswers)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      userContent += `\n\n[User clarifications: ${clarifications}]`;
    }

    // Call the model and parse the response
    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      max_tokens: 1000,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as ParseJobResponse & { clarify?: ParseJobQuestion[] };

    if (!parsed || typeof parsed !== "object") throw new Error("Invalid response shape");

    if ("clarify" in parsed && Array.isArray(parsed.clarify)) {
      return NextResponse.json({ ok: true, clarify: parsed.clarify });
    }

    if (!parsed.noTravelCharge && parsed.statedDistanceKm && parsed.statedDistanceKm > 0) {
      // Operator stated round-trip km but no time. Halve back to a one-way
      // figure so downstream consumers (calcTravelCharge) get the contract
      // they expect; durationMins stays 0 here because there is no time signal.
      parsed.travel = {
        distanceKmOneWay: Math.round((parsed.statedDistanceKm / 2) * 10) / 10,
        durationMins: 0,
        destination: parsed.destination ?? undefined,
      };
    } else if (!parsed.noTravelCharge && parsed.destination) {
      // Look up one-way distance via Google Distance Matrix and pass through
      // unchanged - calcTravelCharge doubles internally for the round-trip
      // charge. Direct call into the helper instead of a self-fetch so this
      // works without NEXT_PUBLIC_BASE_URL set and doesn't burn the public
      // route's rate-limit budget.
      const lookup = await lookupDriveDistance(parsed.destination);
      if (lookup.status === "ok" && lookup.data.distanceKm > 0) {
        parsed.travel = {
          distanceKmOneWay: lookup.data.distanceKm,
          durationMins: lookup.data.durationMins,
          destination: parsed.destination,
        };
      }
    }

    // Resolve task templates and rates
    if (parsed.tasks?.length > 0) {
      const ratesForLookup = rateDtos as unknown as RateConfig[];
      /**
       * Resolves a rate label (e.g. "Standard", "At home") to its {@link RateConfig} row.
       * @param label - Case-insensitive rate label emitted by the AI.
       * @returns Matching RateConfig or null.
       */
      const findRateByLabel = (label: string | null | undefined): RateConfig | null => {
        if (!label) return null;
        const target = label.trim().toLowerCase();
        return ratesForLookup.find((r) => r.label.toLowerCase() === target) ?? null;
      };
      parsed.tasks = parsed.tasks.map((task) => {
        const t = task as typeof task & {
          action?: string | null;
          device?: string | null;
          details?: string | null;
          baseRateLabel?: string | null;
          modifierLabels?: string[];
          isShort?: boolean;
        };
        const snap = findTemplateByTags(t.device, t.action, templates);
        const device = snap?.device ?? t.device ?? null;
        const action = snap?.action ?? t.action ?? null;
        const details = t.details?.trim() ? t.details.trim() : null;

        const baseRate =
          findRateByLabel(t.baseRateLabel) ??
          ratesForLookup.find((r) => r.ratePerHour !== null && r.isDefault) ??
          ratesForLookup.find((r) => r.ratePerHour !== null) ??
          null;
        const modifierIds = (t.modifierLabels ?? [])
          .map((label) => findRateByLabel(label))
          .filter((r): r is RateConfig => r !== null && r.hourlyDelta !== null)
          .map((r) => r.id);

        const computed = effectiveHourlyRate(ratesForLookup, baseRate?.id ?? null, modifierIds);
        const unitPrice = computed > 0 ? computed : (snap?.defaultPrice ?? task.unitPrice ?? 0);

        return {
          ...t,
          // All AI-parsed tasks are hourly work per the prompt. Force null so
          // downstream "is this hourly" checks always agree, regardless of
          // what the AI emitted (omitted, null, stale ID).
          rateConfigId: null,
          device,
          action,
          details,
          baseRateId: baseRate?.id ?? null,
          modifierIds,
          description: composeDescription(device, action, details) || task.description || "",
          unitPrice,
        };
      });
    }

    // Attach the operator-stated ranges so the calculator can render one row
    // per detected segment. Strip the internal durationMins - the calc derives
    // it from start/end on its own.
    const extractedRanges = extractRanges(input);
    if (extractedRanges.length > 0) {
      parsed.ranges = extractedRanges.map(({ startTime, endTime }) => ({ startTime, endTime }));
    } else if (parsed.startTime && parsed.endTime) {
      parsed.ranges = [{ startTime: parsed.startTime, endTime: parsed.endTime }];
    } else {
      parsed.ranges = [];
    }

    // Wall-clock ceiling: AI sometimes inflates durationMins from its own task
    // estimates ("9-9:30" but emits 50 min). Cap durationMins to the stated
    // span - gaps only reduce billable time, never increase it.
    if (parsed.startTime && parsed.endTime && typeof parsed.durationMins === "number") {
      const [sh, sm] = parsed.startTime.split(":").map(Number);
      const [eh, em] = parsed.endTime.split(":").map(Number);
      const wallMin = eh * 60 + em - (sh * 60 + sm);
      if (wallMin > 0 && parsed.durationMins > wallMin) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `AI emitted durationMins ${parsed.durationMins} > ${wallMin}-min wall-clock span. Capped to ${wallMin}.`,
        ];
        parsed.durationMins = wallMin;
      }
    }

    // Safety net: scale floating (non-pinned) tasks proportionally so the sum
    // matches the billable hours total. Tasks the AI flagged `isExplicit`
    // carry an operator-stated duration and pass through untouched - only the
    // floating set absorbs the gap. When every task is pinned, fall back to
    // scaling every task equally so the sum still hits the target.
    if (
      parsed.tasks?.length > 0 &&
      typeof parsed.durationMins === "number" &&
      parsed.durationMins > 0
    ) {
      // Match the calculator's billable rule exactly (round to the live billing
      // increment, floor at the minimum) so the safety net, AI, and invoice agree
      // on the target. incHours is one increment expressed in hours.
      const incHours = settings.pricing.billingIncrementMins / 60;
      const targetHours =
        Math.round(
          (floorBillableMins(
            parsed.durationMins,
            settings.pricing.minBillableMins,
            settings.pricing.billingIncrementMins,
          ) /
            60) *
            100,
        ) / 100;
      const sumQty = parsed.tasks.reduce((s, t) => s + (t.qty || 0), 0);
      const diff = Math.round((targetHours - sumQty) * 100) / 100;
      if (sumQty > 0 && Math.abs(diff) >= incHours) {
        const pinnedSum = parsed.tasks
          .filter((t) => t.isExplicit)
          .reduce((s, t) => s + (t.qty || 0), 0);
        const floatingTargets = targetHours - pinnedSum;
        const floatingSum = sumQty - pinnedSum;
        const canScaleFloating = floatingSum > 0 && floatingTargets > 0;
        const multiplier = canScaleFloating ? floatingTargets / floatingSum : targetHours / sumQty;
        parsed.tasks = parsed.tasks.map((t) => {
          if (canScaleFloating && t.isExplicit) return t;
          return {
            ...t,
            qty: Math.max(incHours, Math.round(t.qty * multiplier * 100) / 100),
          };
        });
        // Park any rounding remainder on the largest floating task (or the
        // largest task overall when nothing is floating) so the sum lands
        // exactly on targetHours.
        const adjustedSum = parsed.tasks.reduce((s, t) => s + t.qty, 0);
        const drift = Math.round((targetHours - adjustedSum) * 100) / 100;
        if (drift !== 0) {
          const driftable = canScaleFloating
            ? parsed.tasks.map((t, i) => ({ t, i })).filter(({ t }) => !t.isExplicit)
            : parsed.tasks.map((t, i) => ({ t, i }));
          if (driftable.length > 0) {
            const largest = driftable.reduce((max, cur) => (cur.t.qty > max.t.qty ? cur : max));
            parsed.tasks[largest.i] = {
              ...parsed.tasks[largest.i],
              qty: Math.max(
                incHours,
                Math.round((parsed.tasks[largest.i].qty + drift) * 100) / 100,
              ),
            };
          }
        }
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          canScaleFloating
            ? `Rebalanced floating task quantities to match the ${targetHours}h total (pinned tasks preserved).`
            : `Rebalanced every task proportionally to match the ${targetHours}h total.`,
        ];
      }
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[parse-job] failed:", err);
    return NextResponse.json({ error: "Could not parse job description" }, { status: 422 });
  }
}
