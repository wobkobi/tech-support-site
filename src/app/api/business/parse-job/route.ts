// src/app/api/business/parse-job/route.ts
/**
 * @description Admin endpoint that turns a plain-English job description into a
 * structured quote. POST pre-computes the worked-minutes total from time ranges,
 * sends a prompt to the model, then resolves task templates and rates, attaches
 * round-trip travel from the extracted destination, caps durationMins to the
 * wall-clock span, and rebalances floating task quantities to match billable
 * hours. May instead return clarification questions when the input is ambiguous.
 */

import { composeDescription, effectiveHourlyRate } from "@/features/business/lib/business";
import { floorBillableMins } from "@/features/business/lib/pricing-policy";
import {
  buildParseJobContext,
  buildParseJobPrompt,
} from "@/features/business/lib/prompts/parse-job";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import type {
  ParseJobQuestion,
  ParseJobResponse,
  ParsedRange,
  RateConfig,
} from "@/features/business/types/business";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/** Internal extension that carries the per-range duration (used by the pre-compute hint). */
interface RangeWithDuration extends ParsedRange {
  durationMins: number;
}

/**
 * Converts an operator-stated HH:MM (NZ wall clock, today) to a Date for the
 * traffic-aware travel lookup. Times already past today roll to tomorrow so
 * the quote stays inside Google's traffic-prediction horizon - mirrors the
 * calculator's client-side jobStartIsoFromTime.
 * @param hhmm - HH:MM (24h) NZ wall-clock string, or null.
 * @returns Date, or undefined when the input isn't a valid HH:MM.
 */
function nzTimeToDate(hhmm: string | null | undefined): Date | undefined {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return undefined;
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return undefined;
  const nzDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(
    new Date(),
  );
  const [y, mo, d] = nzDateStr.split("-").map(Number);
  const offset = getPacificAucklandOffset(y, mo, d);
  let utc = new Date(Date.UTC(y, mo - 1, d, h - offset, m, 0));
  if (utc.getTime() < Date.now()) {
    utc = new Date(utc.getTime() + 24 * 60 * 60 * 1000);
  }
  return utc;
}

// Two times on one line, captured as start/end. The separator is forgiving so
// the operator does not have to type a dash: a dash (-/–/—), the word "to", or
// just whitespace all split the pair. Regex backtracking lets the bare-space
// case work even though each time captures an optional trailing meridiem.
const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s*[-–—]\s*|\s+to\s+|\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;

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
 * Extracts every start/end time segment found on digit-led lines, accepting a
 * dash, "to", or plain whitespace between the two times. Used internally to
 * compute the worked-minutes hint passed to the AI as a "pre-computed session
 * total" annotation.
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
    return errorResponse("Unauthorized", 401);
  }

  // Parse and validate body
  const body = await request.json();
  const { input, answers } = body as { input: unknown; answers?: Record<string, unknown> };

  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return errorResponse("input is required", 400);
  }
  if (input.length > 1000) {
    return errorResponse("input must be 1000 characters or fewer", 400);
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
      // Strip newlines and square brackets so an answer value cannot close the
      // USER DATA sentinel and forge a trusted "[...]" annotation in the region
      // the system prompt declares server-appended and trustworthy.
      const clean = v
        .trim()
        .replace(/[\r\n[\]]/g, " ")
        .slice(0, 200);
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
      userContent += `\n\n[Pre-computed on-site session total from the stated ranges: ${precomputed} min — use this as the base for durationMins; ADD explicitly-stated durations for work done outside these ranges per BILLING rule 1]`;
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
      // figure so downstream consumers get the contract they expect; both
      // leg durations stay 0 here because there is no time signal.
      parsed.travel = {
        distanceKmOneWay: Math.round((parsed.statedDistanceKm / 2) * 10) / 10,
        durationMins: 0,
        durationMinsBack: 0,
        destination: parsed.destination ?? undefined,
      };
    } else if (!parsed.noTravelCharge && parsed.destination) {
      // Look up both drive legs via Google Distance Matrix, each at its own
      // departure: outbound at the parsed job start, return at the parsed end
      // (or start + duration). Missing/invalid times fall back to the
      // lookup's defaults (now / +60 min). Direct call into the helper
      // instead of a self-fetch so this works without NEXT_PUBLIC_BASE_URL
      // set and doesn't burn the public route's rate-limit budget.
      const parsedRanges = parsed.ranges ?? [];
      const departAt = nzTimeToDate(parsed.startTime ?? parsedRanges[0]?.startTime);
      let returnAt = nzTimeToDate(parsed.endTime ?? parsedRanges[parsedRanges.length - 1]?.endTime);
      if (departAt && returnAt && returnAt <= departAt) {
        // Independent roll-forward can invert the pair (start already past
        // rolls to tomorrow while a future end stays today) - keep the
        // return after the outbound leg.
        returnAt = new Date(returnAt.getTime() + 24 * 60 * 60 * 1000);
      }
      if (departAt && !returnAt && parsed.durationMins && parsed.durationMins > 0) {
        returnAt = new Date(departAt.getTime() + parsed.durationMins * 60_000);
      }
      const lookup = await lookupDriveRoundTrip(parsed.destination, departAt, returnAt);
      if (lookup.status === "ok" && lookup.data.there.distanceKm > 0) {
        parsed.travel = {
          distanceKmOneWay: lookup.data.there.distanceKm,
          durationMins: lookup.data.there.durationMins,
          durationMinsBack: lookup.data.back.durationMins,
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
      // Modifier labels the AI emitted that match no live rate (stale name, a
      // since-renamed modifier, or a hallucinated label). Collected so the
      // operator gets a warning instead of the modifier silently vanishing.
      const unresolvedModifierLabels = new Set<string>();
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
        // Billing signals must not print on the invoice line. The prompt
        // forbids them in details, but the model still echoes speed hints
        // ("quick") from inputs like "(quick)" - strip them deterministically
        // and tidy the leftover separators; an emptied details drops to null.
        const rawDetails = t.details?.trim() ? t.details.trim() : null;
        const details = rawDetails
          ? rawDetails
              .replace(/\b(?:quick(?:ly)?|briefly)\b/gi, "")
              .replace(/\s{2,}/g, " ")
              .replace(/\s*,\s*,+/g, ",")
              .replace(/^[\s,;-]+|[\s,;-]+$/g, "")
              .trim() || null
          : null;

        const baseRate =
          findRateByLabel(t.baseRateLabel) ??
          ratesForLookup.find((r) => r.ratePerHour !== null && r.isDefault) ??
          ratesForLookup.find((r) => r.ratePerHour !== null) ??
          null;
        const modifierRates = (t.modifierLabels ?? [])
          .map((label) => {
            const rate = findRateByLabel(label);
            if (!rate) unresolvedModifierLabels.add(label);
            return rate;
          })
          .filter((r): r is RateConfig => r !== null && r.hourlyDelta !== null);
        // Delivery channels (At home / Remote / Phone) are mutually exclusive -
        // the prompt says so, but enforce it here so a model that stacks them
        // anyway (e.g. a call that escalated to screen share emitting both
        // Phone and Remote) cannot compound the discounts. Keep the channel
        // with the highest effective rate; ties keep the first emitted.
        // Matches the DEFAULT label names - renamed channels bypass this guard.
        const CHANNEL_LABELS = new Set(["at home", "remote", "phone"]);
        const channels = modifierRates.filter((r) => CHANNEL_LABELS.has(r.label.toLowerCase()));
        const keptChannel = channels.reduce<RateConfig | null>(
          (best, r) => (best === null || (r.hourlyDelta ?? 0) > (best.hourlyDelta ?? 0) ? r : best),
          null,
        );
        const modifierIds = [
          ...new Set(
            modifierRates
              .filter((r) => !CHANNEL_LABELS.has(r.label.toLowerCase()) || r.id === keptChannel?.id)
              .map((r) => r.id),
          ),
        ];
        if (channels.length > 1) {
          parsed.warnings = [
            ...(parsed.warnings ?? []),
            `Task "${t.details ?? t.action ?? "?"}" had multiple delivery modifiers (${channels
              .map((r) => r.label)
              .join(" + ")}); kept ${keptChannel?.label}.`,
          ];
        }

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
      if (unresolvedModifierLabels.size > 0) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `Dropped unrecognised modifier label(s): ${[...unresolvedModifierLabels].join(
            ", ",
          )}. None match a current rate - check the modifier labels in Settings > Pricing.`,
        ];
      }
    }

    // Out-of-pocket travel disbursements (parking, tolls, ferry) pass through
    // at the stated cost. Sanitise the untrusted model output: finite positive
    // amounts only, short labels, capped count.
    parsed.travelCosts = Array.isArray(parsed.travelCosts)
      ? parsed.travelCosts
          .slice(0, 5)
          .map((c) => ({
            label: typeof c?.label === "string" ? c.label.trim().slice(0, 40) : "",
            cost: Number(c?.cost),
          }))
          .filter(
            (c) => c.label.length > 0 && Number.isFinite(c.cost) && c.cost > 0 && c.cost <= 500,
          )
      : [];

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

    // Sanitise the model's out-of-session minutes (work explicitly stated to
    // have happened outside the session ranges, e.g. a call after the visit).
    const outOfSessionMins =
      typeof parsed.outOfSessionMins === "number" &&
      Number.isFinite(parsed.outOfSessionMins) &&
      parsed.outOfSessionMins > 0
        ? Math.min(Math.round(parsed.outOfSessionMins), 8 * 60)
        : 0;
    parsed.outOfSessionMins = outOfSessionMins;

    // Wall-clock ceiling: AI sometimes inflates durationMins from its own task
    // estimates ("9-9:30" but emits 50 min). Cap durationMins to the stated
    // span plus any out-of-session minutes - gaps only reduce billable time,
    // never increase it, but work after the session adds on top.
    if (parsed.startTime && parsed.endTime && typeof parsed.durationMins === "number") {
      const [sh, sm] = parsed.startTime.split(":").map(Number);
      const [eh, em] = parsed.endTime.split(":").map(Number);
      const wallMin = eh * 60 + em - (sh * 60 + sm);
      const ceiling = wallMin + outOfSessionMins;
      if (wallMin > 0 && parsed.durationMins > ceiling) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `AI emitted durationMins ${parsed.durationMins} > ${ceiling}-min ceiling (${wallMin}-min span + ${outOfSessionMins} out-of-session). Capped to ${ceiling}.`,
        ];
        parsed.durationMins = ceiling;
      }
      // Floor: a model that reports outOfSessionMins but forgets to add it to
      // durationMins would carve the extra work out of the on-site window
      // (under-billing the session tasks). Enforce the sum deterministically.
      const floor = wallMin + outOfSessionMins;
      if (wallMin > 0 && outOfSessionMins > 0 && parsed.durationMins < floor) {
        parsed.durationMins = floor;
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
    return errorResponse("Could not parse job description", 422);
  }
}
