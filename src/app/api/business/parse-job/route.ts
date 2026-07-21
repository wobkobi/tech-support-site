// src/app/api/business/parse-job/route.ts
/**
 * @description Admin endpoint that turns a plain-English job description into
 * a structured quote: prompts the model, resolves task templates and rates,
 * attaches round-trip travel, caps durationMins to the wall-clock span, and
 * rebalances task quantities. May return clarification questions instead.
 */

import { composeDescription, effectiveHourlyRate } from "@/features/business/lib/business";
import { clampBillableMins, MAX_JOB_MINS } from "@/features/business/lib/pricing-policy";
import {
  buildParseJobContext,
  buildParseJobPrompt,
} from "@/features/business/lib/prompts/parse-job";
import { extractRanges } from "@/features/business/lib/time-parse";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import type {
  ParseJobQuestion,
  ParseJobResponse,
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

/**
 * Converts an operator-stated HH:MM (NZ wall clock) to a Date for the
 * traffic-aware travel lookup, anchored to the next occurrence of the job
 * date's WEEKDAY. Google only quotes future departures, so a past job is
 * priced at the same weekday + time as a proxy for that day's actual traffic.
 * Mirrors the calculator's client-side jobStartIsoFromTime.
 * @param hhmm - HH:MM (24h) NZ wall-clock string, or null.
 * @param anchorDate - NZ-local YYYY-MM-DD whose weekday to match (the job date); malformed/missing falls back to today.
 * @returns Date, or undefined when the input isn't a valid HH:MM.
 */
function nzTimeToDate(hhmm: string | null | undefined, anchorDate?: string): Date | undefined {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return undefined;
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return undefined;
  const nzDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(
    new Date(),
  );
  const [y, mo, d] = nzDateStr.split("-").map(Number);
  // Weekday of a Y-M-D is timezone-independent when computed in UTC.
  const todayDow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  let daysAhead = 0;
  if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    const [ay, am, ad] = anchorDate.split("-").map(Number);
    const targetDow = new Date(Date.UTC(ay, am - 1, ad)).getUTCDay();
    daysAhead = (targetDow - todayDow + 7) % 7;
  }
  const offset = getPacificAucklandOffset(y, mo, d);
  let utc = new Date(Date.UTC(y, mo - 1, d + daysAhead, h - offset, m, 0));
  if (utc.getTime() < Date.now()) {
    // Same-day time already passed: next day without an anchor, next week
    // with one (keeping the weekday).
    utc = new Date(utc.getTime() + (daysAhead === 0 && !anchorDate ? 1 : 7) * 24 * 60 * 60 * 1000);
  }
  return utc;
}

/**
 * Canonicalises one AI-emitted tag: case-variants of a known tag snap to the
 * stored casing so near-duplicates can't split the taxonomy or the price
 * memory. Unknown tags pass through trimmed - the vocabulary stays open, and
 * the caller warns the operator so a new tag is a visible decision, not drift.
 * @param tag - Device or action tag from the AI.
 * @param known - Lowercased tag > stored casing, built from the templates.
 * @returns Canonical tag, or null when the input was empty.
 */
function canonicaliseTag(
  tag: string | null | undefined,
  known: Map<string, string>,
): string | null {
  const trimmed = tag?.trim();
  if (!trimmed) return null;
  return known.get(trimmed.toLowerCase()) ?? trimmed;
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
  const { input, answers, jobDate } = body as {
    input: unknown;
    answers?: Record<string, unknown>;
    jobDate?: unknown;
  };
  // Job date (NZ-local YYYY-MM-DD) anchors travel quotes to the job's weekday.
  const jobDateAnchor =
    typeof jobDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(jobDate) ? jobDate : undefined;

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

    // Parse the stated time ranges once - reused below to attach parsed.ranges.
    const extractedRanges = extractRanges(input);
    const precomputed =
      extractedRanges.length > 0
        ? extractedRanges.reduce((sum, r) => sum + r.durationMins, 0)
        : null;
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
      // (or start + duration); missing times use the lookup's defaults. Direct
      // helper call, not a self-fetch - works without NEXT_PUBLIC_BASE_URL and
      // doesn't burn the public route's rate-limit budget.
      const parsedRanges = parsed.ranges ?? [];
      const departAt = nzTimeToDate(parsed.startTime ?? parsedRanges[0]?.startTime, jobDateAnchor);
      let returnAt = nzTimeToDate(
        parsed.endTime ?? parsedRanges[parsedRanges.length - 1]?.endTime,
        jobDateAnchor,
      );
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
      // Known-tag maps (lowercased > stored casing) for canonicaliseTag, so
      // emitted case-variants land on the taxonomy's existing spelling.
      const knownDevices = new Map(
        templates.flatMap((t): [string, string][] =>
          t.device ? [[t.device.toLowerCase(), t.device]] : [],
        ),
      );
      const knownActions = new Map(
        templates.flatMap((t): [string, string][] =>
          t.action ? [[t.action.toLowerCase(), t.action]] : [],
        ),
      );
      // Tags the model coined that aren't in the taxonomy. Surfaced as a
      // warning so a genuinely new tag is a visible operator decision and a
      // drifted synonym gets corrected before it splits the price history.
      const newTags = new Set<string>();
      parsed.tasks = parsed.tasks.map((task) => {
        const t = task as typeof task & {
          action?: string | null;
          device?: string | null;
          details?: string | null;
          baseRateLabel?: string | null;
          modifierLabels?: string[];
          isShort?: boolean;
        };
        // Canonicalise BEFORE the template snap so a case-drifted tag still
        // finds its template and its remembered price.
        const device = canonicaliseTag(t.device, knownDevices);
        const action = canonicaliseTag(t.action, knownActions);
        if (device && !knownDevices.has(device.toLowerCase())) newTags.add(device);
        if (action && !knownActions.has(action.toLowerCase())) newTags.add(action);
        const snap = findTemplateByTags(device, action, templates);
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
        // the prompt says so, but enforce it so a model that stacks them cannot
        // compound the discounts. Keep the channel with the highest effective
        // rate; ties keep the first emitted. Matches the DEFAULT label names -
        // renamed channels bypass this guard.
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
      if (newTags.size > 0) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `New tag(s) not in the current taxonomy: ${[...newTags].join(
            ", ",
          )}. Fine for genuinely new work - otherwise switch the task to the existing tag so the price history stays on one key.`,
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
    // it from start/end on its own (extractedRanges was parsed once, above).
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
        ? Math.min(Math.round(parsed.outOfSessionMins), MAX_JOB_MINS)
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
          (clampBillableMins(
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
        // Operator-stated durations are EXACT - pinned tasks are never scaled
        // or drift-parked. When nothing is floating (every task pinned), the
        // sum simply stands and the mismatch surfaces as a warning for the
        // operator instead of silently moving stated times.
        const canScaleFloating = floatingSum > 0 && floatingTargets > 0;
        if (canScaleFloating) {
          const multiplier = floatingTargets / floatingSum;
          parsed.tasks = parsed.tasks.map((t) => {
            if (t.isExplicit) return t;
            return {
              ...t,
              qty: Math.max(incHours, Math.round(t.qty * multiplier * 100) / 100),
            };
          });
          // Park any rounding remainder on the largest floating task so the
          // sum lands exactly on targetHours.
          const adjustedSum = parsed.tasks.reduce((s, t) => s + t.qty, 0);
          const drift = Math.round((targetHours - adjustedSum) * 100) / 100;
          if (drift !== 0) {
            const driftable = parsed.tasks
              .map((t, i) => ({ t, i }))
              .filter(({ t }) => !t.isExplicit);
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
            `Rebalanced floating task quantities to match the ${targetHours}h total (stated durations untouched).`,
          ];
        } else {
          parsed.warnings = [
            ...(parsed.warnings ?? []),
            `Task hours sum to ${Math.round(sumQty * 100) / 100}h but the stated times total ${targetHours}h - stated durations were left untouched; adjust manually if needed.`,
          ];
        }
      }
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[parse-job] failed:", err);
    return errorResponse("Could not parse job description", 422);
  }
}
