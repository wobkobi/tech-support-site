// src/app/api/business/parse-job/route.ts
// Turns a plain-English job description into a structured quote (or clarifying
// questions), then sanitises the model output: travel, rates, duration caps, task fit.

import {
  composeDescription,
  effectiveHourlyRate,
  isChannelModifier,
  restatesTaskLine,
} from "@/features/business/lib/business";
import { isBusinessModifier, withJobModifiers } from "@/features/business/lib/job-modifiers";
import { clampBillableMins } from "@/features/business/lib/pricing-policy";
import {
  buildParseJobContext,
  buildParseJobPrompt,
} from "@/features/business/lib/prompts/parse-job";
import { canonicalTagMap, canonicaliseTag } from "@/features/business/lib/task-taxonomy";
import { extractRangeStats } from "@/features/business/lib/time-parse";
import { lookupDriveRoundTrip, lookupStoreRun } from "@/features/business/lib/travel-distance";
import type {
  ParseJobQuestion,
  ParseJobResponse,
  RateConfig,
} from "@/features/business/types/business";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { isAiRateLimitError, jsonCompletion } from "@/shared/lib/ai/json-completion";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { roundCents } from "@/shared/lib/money";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NZ_TZ, nextNzWallClockOnWeekday, timeParts } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

/** Clarifying-question ids the calculator's form can answer (the prompt's clarify block). */
const CLARIFY_IDS = new Set(["location", "duration", "tasks"]);

/**
 * NZ HH:MM on the next occurrence of the job date's WEEKDAY, for the traffic lookup.
 * Google only quotes future departures, so the same weekday + time stands in.
 * @param hhmm - HH:MM (24h) NZ wall-clock string, or null.
 * @param anchorDate - NZ-local YYYY-MM-DD whose weekday to match (the job date); malformed/missing falls back to today.
 * @returns Date, or undefined when the input isn't a valid HH:MM.
 */
function nzTimeToDate(hhmm: string | null | undefined, anchorDate?: string): Date | undefined {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return undefined;
  const [h, m] = timeParts(hhmm);
  if (h > 23 || m > 59) return undefined;
  return nextNzWallClockOnWeekday(h, m, anchorDate);
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
 * POST /api/business/parse-job - Parses a plain-English job description.
 * `fallbackDestination` is used when the text names no address.
 * @param request - Incoming Next.js request with input string in body
 * @returns JSON with structured ParseJobResponse or a 422 error
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Outside the try below, so a malformed body must 400 here rather than 500.
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return errorResponse("Invalid request body", 400);
  }
  const { input, answers, jobDate, fallbackDestination, meetingType, billedToCompany } = body as {
    input: unknown;
    answers?: Record<string, unknown>;
    jobDate?: unknown;
    fallbackDestination?: unknown;
    meetingType?: unknown;
    billedToCompany?: unknown;
  };
  // Facts the calculator knows that the description may not say.
  const remoteBooked = meetingType === "remote";
  const companyBill = billedToCompany === true;
  // Job date (NZ-local YYYY-MM-DD) anchors travel quotes to the job's weekday.
  const jobDateAnchor =
    typeof jobDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(jobDate) ? jobDate : undefined;
  // Used only when the AI finds no destination. Never enters the prompt.
  const fallbackDest =
    typeof fallbackDestination === "string"
      ? fallbackDestination.trim().slice(0, 200) || undefined
      : undefined;

  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return errorResponse("input is required", 400);
  }
  if (input.length > 1000) {
    return errorResponse("input must be 1000 characters or fewer", 400);
  }

  // Whitelist answer keys so a crafted payload can't smuggle text into the trusted segment.
  const ALLOWED_ANSWER_KEYS = new Set(["location", "duration", "tasks"]);
  const safeAnswers: Record<string, string> = {};
  if (answers && typeof answers === "object") {
    for (const [k, v] of Object.entries(answers)) {
      if (!ALLOWED_ANSWER_KEYS.has(k)) continue;
      if (typeof v !== "string") continue;
      // Strip newlines and brackets so an answer can't forge a trusted "[...]" annotation.
      const clean = v
        .trim()
        .replace(/[\r\n[\]]/g, " ")
        .slice(0, 200);
      if (clean) safeAnswers[k] = clean;
    }
  }

  try {
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
      timeZone: NZ_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());

    // Static system prompt (cacheable); per-call data goes in the user message.
    const systemPrompt = buildParseJobPrompt();
    const context = buildParseJobContext(
      rateDtos,
      templateDtos,
      currentTime,
      { company, name, location },
      {
        minBillableMins: settings.pricing.minBillableMins,
        incrementMins: settings.pricing.billingIncrementMins,
        shortTaskMins: settings.pricing.shortTaskMins,
        noFixFreeMins: settings.pricing.noFixFreeMins,
        workmanshipWindowDays: settings.pricing.workmanshipWindowDays,
      },
    );
    // Live ceiling on one job's billable time; clamps the model's minutes below.
    const maxJobMins = settings.pricing.maxJobMins;

    // Parsed once; reused for parsed.ranges and the overlap warning.
    const rangeStats = extractRangeStats(input);
    const extractedRanges = rangeStats.ranges;
    const precomputed =
      extractedRanges.length > 0
        ? extractedRanges.reduce((sum, r) => sum + r.durationMins, 0)
        : null;
    // Close the untrusted USER DATA block before any trusted annotations.
    let userContent = `${context}${input.trim()}\n--- END USER DATA ---`;
    // Name the task-line ranges the total already holds, or the model bills them again.
    // Server-formatted times only - this sits outside the untrusted block.
    const taskLineNote =
      rangeStats.taskLineRanges.length > 0
        ? ` (already includes, from ranges written on a task's own line - see SECOND-VISIT RANGE: ${rangeStats.taskLineRanges
            .map((r) => `${r.startTime}-${r.endTime} = ${r.durationMins} min`)
            .join("; ")})`
        : "";
    if (precomputed !== null) {
      userContent += `\n\n[Pre-computed on-site session total from the stated ranges: ${precomputed} min${taskLineNote} — use this as the base for durationMins; ADD explicitly-stated durations for work done outside these ranges per BILLING rule 1]`;
    }
    if (Object.keys(safeAnswers).length > 0) {
      const clarifications = Object.entries(safeAnswers)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      userContent += `\n\n[User clarifications: ${clarifications}]`;
    }
    if (remoteBooked) {
      userContent += `\n\n[Booking: this job was booked as a remote session]`;
    }
    if (companyBill) {
      userContent += `\n\n[Invoice: billed to the client's company]`;
    }

    // gpt-4.1, not -mini: mini obeys an injected negative-duration correction. One attempt,
    // since SDK retry defaults can outlive the 300s ceiling and swallow a retryable 429.
    const { text, model, usage } = await jsonCompletion({
      feature: "parse-job",
      openAiModel: "gpt-4.1",
      system: [systemPrompt],
      user: userContent,
      maxTokens: 1000,
      temperature: 0,
      timeoutMs: 25_000,
      maxRetries: 0,
    });

    // The ~13.9k-token system prompt's cache hit decides most of the cost.
    console.log(
      `[parse-job] ${model} prompt ${usage.input} tokens, ${usage.cached} cached, completion ${usage.output}`,
    );

    const parsed = JSON.parse(text) as ParseJobResponse & { clarify?: ParseJobQuestion[] };

    if (!parsed || typeof parsed !== "object") throw new Error("Invalid response shape");

    // Only well-formed questions the form can ask; a garbled list would leave nothing.
    if ("clarify" in parsed && Array.isArray(parsed.clarify)) {
      const questions = parsed.clarify
        .filter(
          (q): q is ParseJobQuestion =>
            !!q &&
            typeof q === "object" &&
            CLARIFY_IDS.has(q.id) &&
            typeof q.question === "string" &&
            q.question.trim() !== "",
        )
        .slice(0, 3)
        .map((q) => ({
          id: q.id,
          question: q.question.trim(),
          ...(typeof q.hint === "string" && q.hint.trim() && { hint: q.hint.trim() }),
        }));
      if (questions.length > 0) return NextResponse.json({ ok: true, clarify: questions });
      if (!Array.isArray(parsed.tasks)) throw new Error("Clarify reply with no usable questions");
    }

    // Coerce a bad shape to no tasks / no duration rather than crash the clamps below.
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (typeof parsed.durationMins !== "number" || !Number.isFinite(parsed.durationMins)) {
      parsed.durationMins = null;
    }

    // Untrusted model output: short distinct stores, strict boolean, positive cents.
    parsed.paidCash = parsed.paidCash === true;
    const cash = Number(parsed.cashPaid);
    parsed.cashPaid =
      parsed.paidCash && Number.isFinite(cash) && cash > 0 ? roundCents(cash) : null;
    const storeRuns: string[] = [];
    for (const raw of Array.isArray(parsed.storeRuns) ? parsed.storeRuns : []) {
      const store = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
      if (store && !storeRuns.some((s) => s.toLowerCase() === store.toLowerCase())) {
        storeRuns.push(store);
      }
    }
    parsed.storeRuns = storeRuns.slice(0, 3);
    // A store as the destination would bill the round trip to the store; drop it.
    if (
      parsed.destination &&
      parsed.storeRuns.some((s) => s.toLowerCase() === parsed.destination?.trim().toLowerCase())
    ) {
      parsed.destination = null;
    }

    // Booked-job descriptions rarely restate the address; an explicit no-travel still wins.
    if (!parsed.destination && !parsed.noTravelCharge && fallbackDest) {
      parsed.destination = fallbackDest;
    }

    const statedKm =
      !parsed.noTravelCharge && parsed.statedDistanceKm && parsed.statedDistanceKm > 0
        ? parsed.statedDistanceKm
        : null;
    if (statedKm !== null && !parsed.destination) {
      // Travel bills on drive time, so km with no address prices nothing - warn instead.
      parsed.travel = {
        distanceKmOneWay: Math.round((statedKm / 2) * 10) / 10,
        durationMins: 0,
        durationMinsBack: 0,
      };
      parsed.warnings = [
        ...(parsed.warnings ?? []),
        `A ${statedKm} km trip was mentioned but there's no address to time the drive, so no travel was charged. Add the address or a travel line by hand.`,
      ];
    } else if (!parsed.noTravelCharge && parsed.destination) {
      // Outbound at the parsed start, return at the parsed end (or start + duration).
      const parsedRanges = parsed.ranges ?? [];
      const departAt = nzTimeToDate(parsed.startTime ?? parsedRanges[0]?.startTime, jobDateAnchor);
      let returnAt = nzTimeToDate(
        parsed.endTime ?? parsedRanges[parsedRanges.length - 1]?.endTime,
        jobDateAnchor,
      );
      if (departAt && returnAt && returnAt <= departAt) {
        // Independent roll-forward can put the start tomorrow and the end today.
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
      } else if (lookup.status !== "ok") {
        // A failed lookup would otherwise leave the invoice with no travel and no hint.
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `Couldn't look up the drive to ${parsed.destination}, so no travel was charged. Check the address or add travel by hand.`,
        ];
      }
    }

    // Each store run is timed from the client's place, so it needs that address.
    const clientPlace = parsed.destination;
    if (parsed.storeRuns.length > 0 && !clientPlace) {
      parsed.warnings = [
        ...(parsed.warnings ?? []),
        `A store run to ${parsed.storeRuns.join(" and ")} was mentioned, but there's no client address to time it from. Add the address, then the store run by hand.`,
      ];
    } else if (clientPlace) {
      const lookups = await Promise.all(
        parsed.storeRuns.map(async (store) => ({
          store,
          lookup: await lookupStoreRun(clientPlace, store),
        })),
      );
      parsed.storeRunTravel = [];
      for (const { store, lookup } of lookups) {
        if (lookup.status === "ok" && lookup.data.there.durationMins > 0) {
          parsed.storeRunTravel.push({
            store,
            durationMinsThere: lookup.data.there.durationMins,
            durationMinsBack: lookup.data.back.durationMins,
            distanceKm: lookup.data.there.distanceKm,
          });
        } else {
          parsed.warnings = [
            ...(parsed.warnings ?? []),
            `Couldn't time the store run to ${store}, so it wasn't charged. Add it by hand with + Store run.`,
          ];
        }
      }
    }

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
      // Labels matching no live rate, warned about rather than silently dropped.
      const unresolvedModifierLabels = new Set<string>();
      // Lowercased > canonical casing; the busiest casing wins, so one stray "Pc" can't
      // displace "PC".
      const knownDevices = canonicalTagMap(templates, "device");
      const knownActions = canonicalTagMap(templates, "action");
      // Remote fills in on a remote booking with no trip. Business is all or nothing.
      const jobFacts = {
        remoteBooking: remoteBooked && !parsed.destination,
        business:
          companyBill ||
          parsed.tasks.some((task) =>
            ((task as { modifierLabels?: string[] }).modifierLabels ?? []).some((label) =>
              isBusinessModifier({ label }),
            ),
          ),
      };
      let remoteAdded = 0;
      let businessAdded = 0;
      // Coined tags are warned about so a drifted synonym can't split the price history.
      const newTags = new Set<string>();
      const strippedSpeedHints = new Set<string>();
      const strippedRestatements = new Set<string>();
      parsed.tasks = parsed.tasks.map((task) => {
        const t = task as typeof task & {
          action?: string | null;
          device?: string | null;
          details?: string | null;
          baseRateLabel?: string | null;
          modifierLabels?: string[];
          isShort?: boolean;
        };
        // Canonicalise BEFORE the template snap so a case-drifted tag still matches.
        const device = canonicaliseTag(t.device, knownDevices);
        const action = canonicaliseTag(t.action, knownActions);
        if (device && !knownDevices.has(device.toLowerCase())) newTags.add(device);
        if (action && !knownActions.has(action.toLowerCase())) newTags.add(action);
        const snap = findTemplateByTags(device, action, templates);
        // Drop speed hints the model echoes into details, but only whole comma items -
        // "Quick Assist" is a real product. Each drop warns, flagging prompt drift.
        const rawDetails = t.details?.trim() ? t.details.trim() : null;
        let details: string | null = null;
        if (rawDetails) {
          const kept: string[] = [];
          for (const part of rawDetails.split(",")) {
            const item = part.trim();
            if (!item) continue;
            if (/^(?:quick(?:ly)?|briefly)$/i.test(item)) {
              strippedSpeedHints.add(item.toLowerCase());
              continue;
            }
            // The prompt's details INVARIANT forbids this too; same drop-and-warn backstop.
            if (restatesTaskLine(item, device, action)) {
              strippedRestatements.add(`"${composeDescription(device, action, item)}"`);
              continue;
            }
            kept.push(item);
          }
          details = kept.join(", ") || null;
        }

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
        // Delivery channels are mutually exclusive so discounts can't compound; the highest
        // rate wins, ties keep the first.
        const channels = modifierRates.filter(isChannelModifier);
        const keptChannel = channels.reduce<RateConfig | null>(
          (best, r) => (best === null || (r.hourlyDelta ?? 0) > (best.hourlyDelta ?? 0) ? r : best),
          null,
        );
        const channelIds = [
          ...new Set(
            modifierRates
              .filter((r) => !isChannelModifier(r) || r.id === keptChannel?.id)
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

        const job = withJobModifiers(channelIds, ratesForLookup, jobFacts);
        const modifierIds = job.ids;
        if (job.addedRemote) remoteAdded++;
        if (job.addedBusiness) businessAdded++;

        const computed = effectiveHourlyRate(ratesForLookup, baseRate?.id ?? null, modifierIds);
        const unitPrice = computed > 0 ? computed : (snap?.defaultPrice ?? task.unitPrice ?? 0);

        return {
          ...t,
          // AI-parsed tasks are always hourly, whatever the model emitted.
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
      if (strippedSpeedHints.size > 0) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `Removed speed hint(s) from the invoice wording: ${[...strippedSpeedHints].join(
            ", ",
          )}. These set how long the task is billed for; they are not part of what the customer is told was done.`,
        ];
      }
      if (strippedRestatements.size > 0) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `Dropped wording that only repeated the line: ${[...strippedRestatements].join(
            ", ",
          )}. The device and action already say it.`,
        ];
      }
      if (remoteAdded > 0) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `Booked as a remote session: Remote added to ${remoteAdded} task(s) the description gave no other channel for.`,
        ];
      }
      if (businessAdded > 0) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          companyBill
            ? `Billed to a company: Business rate added to ${businessAdded} task(s).`
            : `Business rate added to ${businessAdded} more task(s) so the whole job bills at it.`,
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

    // Parking/tolls/ferry pass through at cost; sanitise the untrusted output.
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

    // Parts bill at face value: named, positive, plausible. Drops are warned about.
    const rawParts: unknown[] = Array.isArray(parsed.parts) ? parsed.parts : [];
    parsed.parts = rawParts
      .slice(0, 20)
      .map((p) => {
        const part = p as { description?: unknown; cost?: unknown } | null;
        return {
          description:
            typeof part?.description === "string" ? part.description.trim().slice(0, 120) : "",
          cost: Number(part?.cost),
        };
      })
      .filter(
        (p) => p.description.length > 0 && Number.isFinite(p.cost) && p.cost > 0 && p.cost <= 10000,
      );
    if (parsed.parts.length < rawParts.length) {
      parsed.warnings = [
        ...(parsed.warnings ?? []),
        "A part was left off because its name or price didn't make sense. Add it by hand if it belongs on the invoice.",
      ];
    }

    // One calculator row per stated range; the calc derives durations itself.
    if (extractedRanges.length > 0) {
      parsed.ranges = extractedRanges.map(({ startTime, endTime }) => ({ startTime, endTime }));
    } else if (parsed.startTime && parsed.endTime) {
      parsed.ranges = [{ startTime: parsed.startTime, endTime: parsed.endTime }];
    } else {
      parsed.ranges = [];
    }

    // An overlap silently shrinks the window and the reconciliation below can't see it.
    // On a multi-day job it's usually a missing date header.
    if (rangeStats.discardedMins > 0) {
      parsed.warnings = [
        ...(parsed.warnings ?? []),
        `Overlapping time ranges: ${rangeStats.statedMins} min stated but ${rangeStats.billableMins} min billed (${rangeStats.discardedMins} min dropped as double-counted). If those ranges were on different days, put a date or weekday line above each day.`,
      ];
    }

    // Out-of-session minutes need a session; on a phone-only job they'd leave a
    // zero-length session.
    const hasSession = precomputed !== null || (!!parsed.startTime && !!parsed.endTime);
    const outOfSessionMins =
      hasSession &&
      typeof parsed.outOfSessionMins === "number" &&
      Number.isFinite(parsed.outOfSessionMins) &&
      parsed.outOfSessionMins > 0
        ? Math.min(Math.round(parsed.outOfSessionMins), maxJobMins)
        : 0;
    parsed.outOfSessionMins = outOfSessionMins;

    // Wall-clock ceiling: the model inflates durationMins ("9-9:30" emitted as 50 min).
    // Cap to the stated span plus out-of-session minutes.
    if (parsed.startTime && parsed.endTime && typeof parsed.durationMins === "number") {
      const [sh, sm] = timeParts(parsed.startTime);
      const [eh, em] = timeParts(parsed.endTime);
      // One clock span would cap two 9-5 days at 8h; stated ranges give each day its span.
      const wallMin =
        rangeStats.ranges.length > 0 ? rangeStats.spanMins : eh * 60 + em - (sh * 60 + sm);
      const ceiling = wallMin + outOfSessionMins;
      if (wallMin > 0 && parsed.durationMins > ceiling) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `AI emitted durationMins ${parsed.durationMins} > ${ceiling}-min ceiling (${wallMin}-min span + ${outOfSessionMins} out-of-session). Capped to ${ceiling}.`,
        ];
        parsed.durationMins = ceiling;
      }
      // Floor: the model may report outOfSessionMins but not add it to durationMins.
      const floor = wallMin + outOfSessionMins;
      if (wallMin > 0 && outOfSessionMins > 0 && parsed.durationMins < floor) {
        parsed.durationMins = floor;
      }
    }

    // Stated ranges bound the bill, so an injected "bill 8 hours" can't move it.
    // Below-cap values pass through (free work subtracts).
    if (precomputed !== null && precomputed > 0) {
      const statedTotal = precomputed + outOfSessionMins;
      // The day ceiling applies per day: two 9-5 days bill both, one 12pm-12am day is cut.
      const minsByDay = new Map<number, number>();
      for (const r of extractedRanges) {
        minsByDay.set(r.day, (minsByDay.get(r.day) ?? 0) + r.durationMins);
      }
      const dayCapped = [...minsByDay.values()].reduce((s, m) => s + Math.min(m, maxJobMins), 0);
      const cap = dayCapped + outOfSessionMins;
      if (typeof parsed.durationMins === "number" && parsed.durationMins > cap) {
        // Name the constraint that bound, so a long real day isn't blamed on the model.
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          cap < statedTotal
            ? `A day states more than the ${maxJobMins} min longest-billable-day ceiling; capped the job to ${cap} min. Raise it in Settings > Pricing if a day this long really bills in full.`
            : `AI emitted durationMins ${parsed.durationMins} above the stated ${cap} min total; capped.`,
        ];
        parsed.durationMins = cap;
      }
      if (
        (parsed.tasks?.length ?? 0) > 0 &&
        (typeof parsed.durationMins !== "number" || parsed.durationMins <= 0)
      ) {
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `AI emitted no usable durationMins despite stated ranges; restored the stated ${cap} min.`,
        ];
        parsed.durationMins = cap;
      }
    } else if (typeof parsed.durationMins === "number" && parsed.durationMins < 0) {
      // No stated ranges to restore from - drop garbage negatives entirely.
      parsed.durationMins = null;
    } else if (
      typeof parsed.durationMins === "number" &&
      parsed.durationMins > maxJobMins + outOfSessionMins
    ) {
      // Only the day ceiling bounds a bare duration ("2 days" misread as 48 hours).
      parsed.warnings = [
        ...(parsed.warnings ?? []),
        `Duration of ${parsed.durationMins} min is over the ${maxJobMins} min longest-billable-day ceiling; capped. For a job over several days, give each day's times.`,
      ];
      parsed.durationMins = maxJobMins + outOfSessionMins;
    }

    // Fit task quantities to the billable total. `isExplicit` and `isShort` tasks are
    // pinned; the floating set snaps to the billing grid (no 0.85h nobody worked).
    if (
      parsed.tasks?.length > 0 &&
      typeof parsed.durationMins === "number" &&
      parsed.durationMins > 0
    ) {
      // Same billable rule as the calculator, so AI and invoice agree on the target.
      const incMins = settings.pricing.billingIncrementMins;
      const incHours = incMins / 60;
      const targetMins = clampBillableMins(
        parsed.durationMins,
        settings.pricing.minBillableMins,
        incMins,
      );
      const targetHours = Math.round((targetMins / 60) * 100) / 100;
      // Snap to whole minutes up front: a 2 dp qty can't hold a 5-min step (0.17h = 10.2 min).
      /**
       * Model qty as grid minutes, at least one increment. Stated durations round UP
       * ("took 12 mins" never bills 10); the epsilon stops 0.25h * 60 = 15.000000000000002
       * ceiling to the next step.
       * @param qty - Task quantity in decimal hours, as the model emitted it.
       * @param explicit - Whether the operator stated this task's duration.
       * @returns Billed minutes, a multiple of the billing increment.
       */
      const snapTaskMins = (qty: number, explicit: boolean): number => {
        const steps = ((qty || 0) * 60) / incMins;
        return Math.max(
          incMins,
          (explicit ? Math.ceil(steps - 1e-9) : Math.round(steps)) * incMins,
        );
      };
      parsed.tasks = parsed.tasks.map((t) => {
        const mins = snapTaskMins(t.qty, !!(t as { isExplicit?: boolean }).isExplicit);
        return { ...t, minutes: mins, qty: mins / 60 };
      });
      const sumQty = parsed.tasks.reduce((s, t) => s + (t.qty || 0), 0);
      const diff = Math.round((targetHours - sumQty) * 100) / 100;
      if (sumQty > 0 && Math.abs(diff) >= incHours) {
        /**
         * Whether a task's quantity is fixed (stated duration or quick one-shot).
         * @param t - Task to classify.
         * @param t.isExplicit - Set when the operator stated this task's duration.
         * @param t.isShort - Set when the task is a quick one-shot job.
         * @returns True when the task is pinned.
         */
        const isPinned = (t: { isExplicit?: boolean; isShort?: boolean }): boolean =>
          !!t.isExplicit || !!t.isShort;
        const pinnedMins = parsed.tasks.filter(isPinned).reduce((s, t) => s + (t.minutes ?? 0), 0);
        const floatingIdx = parsed.tasks.map((t, i) => ({ t, i })).filter(({ t }) => !isPinned(t));
        const floatingSumMins = floatingIdx.reduce((s, { t }) => s + (t.minutes ?? 0), 0);
        const floatingTargetMins = targetMins - pinnedMins;
        // Each floating task keeps at least one increment.
        const canScaleFloating =
          floatingSumMins > 0 && floatingTargetMins >= floatingIdx.length * incMins;
        if (canScaleFloating) {
          // Floor proportional shares to the grid, then hand the remainder to the largest
          // first - the prompt's subBase + subLeftover split.
          const multiplier = floatingTargetMins / floatingSumMins;
          const shares = floatingIdx.map(({ t, i }) => {
            const rawMins = (t.minutes ?? 0) * multiplier;
            return { i, rawMins, mins: Math.max(incMins, Math.floor(rawMins / incMins) * incMins) };
          });
          let leftover = floatingTargetMins - shares.reduce((s, x) => s + x.mins, 0);
          for (const share of [...shares].sort((a, b) => b.rawMins - a.rawMins)) {
            if (leftover < incMins) break;
            share.mins += incMins;
            leftover -= incMins;
          }
          // Sub-increment leftover goes to the largest share so the window is exact.
          if (leftover > 0 && shares.length > 0) {
            shares.reduce((max, cur) => (cur.mins > max.mins ? cur : max)).mins += leftover;
          }
          for (const { i, mins } of shares) {
            parsed.tasks[i] = { ...parsed.tasks[i]!, minutes: mins, qty: mins / 60 };
          }
          parsed.warnings = [
            ...(parsed.warnings ?? []),
            `Rebalanced floating task quantities to match the ${targetHours}h total (stated and quick-task durations untouched).`,
          ];
        } else {
          // Nothing floating to absorb the gap. Up to one step of overshoot per pinned task
          // is expected (they round UP); beyond that the window itself is usually wrong.
          const pinnedCount = parsed.tasks.filter(isPinned).length;
          const overshoot = Math.round((sumQty - parsed.durationMins / 60) * 100) / 100;
          // Under the minimum, the gap is the floor doing its job, not a window problem.
          const flooredByMinimum = parsed.durationMins < settings.pricing.minBillableMins;
          if ((sumQty < targetHours && !flooredByMinimum) || overshoot > pinnedCount * incHours) {
            parsed.warnings = [
              ...(parsed.warnings ?? []),
              `Task hours sum to ${Math.round(sumQty * 100) / 100}h but the stated times total ${targetHours}h - stated and quick-task durations were left untouched. Check the session window for a break or an overlapping range.`,
            ];
          }
        }
      }
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[parse-job] failed:", err);
    // Upstream 429s are transient, so mark them retryable.
    if (isAiRateLimitError(err)) {
      return aiRateLimitResponse(err);
    }
    return errorResponse("Could not parse job description", 422);
  }
}
