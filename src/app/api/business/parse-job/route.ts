import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { buildParseJobPrompt } from "@/features/business/lib/prompts/parse-job";
import { effectiveHourlyRate, composeDescription } from "@/features/business/lib/business";
import type {
  ParseJobResponse,
  ParseJobQuestion,
  RateConfig,
} from "@/features/business/types/business";

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
 * Sums all HH:MM–HH:MM segments on lines that start with a digit.
 * Handles noon/midnight crossings and trailing meridiems (e.g. "7-9pm" = 7pm-9pm).
 * @param input - Raw job description text.
 * @returns Total worked minutes, or null if no time ranges detected.
 */
function calcSessionMins(input: string): number | null {
  let total = 0;
  let found = false;
  for (const line of input.split("\n")) {
    if (!/^\d/.test(line.trim())) continue;
    TIME_RANGE_RE.lastIndex = 0;
    const m = TIME_RANGE_RE.exec(line);
    if (!m) continue;
    // "7-9pm" -> both pm; "9-11am" -> both am. If only one side has a marker,
    // the other side inherits it (covers the common shorthand).
    const startMeridiem = meridiemOf(m[1]);
    const endMeridiem = meridiemOf(m[2]);
    const start = parseTimeMins(m[1], startMeridiem ?? endMeridiem);
    const end = parseTimeMins(m[2], endMeridiem ?? startMeridiem);
    if (start === null || end === null) continue;
    let dur = end - start;
    if (dur <= 0) {
      // Prefer the smallest positive result that fits a reasonable session (≤ 16h).
      // +12h handles unmarked am/pm crossing noon (e.g. "11:25-1:20" → 115 min).
      // +24h is the fallback for overnight runs.
      const withNoon = dur + 12 * 60;
      dur = withNoon > 0 && withNoon <= 16 * 60 ? withNoon : dur + 24 * 60;
    }
    total += dur;
    found = true;
  }
  return found ? total : null;
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
 * POST /api/business/parse-job - Parses a plain-English job description using gpt-4o.
 * Pre-computes session total from time ranges and attaches travel info from the AI-extracted destination.
 * @param request - Incoming Next.js request with input string in body
 * @returns JSON with structured ParseJobResponse or a 422 error
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { input, answers } = body as { input: unknown; answers?: Record<string, string> };

  if (!input || typeof input !== "string" || input.trim().length === 0) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }
  if (input.length > 1000) {
    return NextResponse.json({ error: "input must be 1000 characters or fewer" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const [rates, templates] = await Promise.all([
      prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
      prisma.taskTemplate.findMany({ orderBy: [{ usageCount: "desc" }, { description: "asc" }] }),
    ]);

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

    const systemPrompt = buildParseJobPrompt(rateDtos, templateDtos, currentTime);

    const precomputed = calcSessionMins(input);
    let userContent =
      precomputed !== null
        ? `${input.trim()}\n\n[Pre-computed session total: ${precomputed} min — use this as durationMins without recalculating]`
        : input.trim();
    if (answers && Object.keys(answers).length > 0) {
      const clarifications = Object.entries(answers)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      userContent += `\n\n[User clarifications: ${clarifications}]`;
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
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
      parsed.travel = {
        distanceKm: parsed.statedDistanceKm,
        durationMins: 0,
        destination: parsed.destination ?? undefined,
      };
    } else if (!parsed.noTravelCharge && parsed.destination) {
      // No stated distance - look up one-way and double for round trip.
      try {
        const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
        const travelRes = await fetch(`${base}/api/pricing/travel-time`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination: parsed.destination }),
        });
        if (travelRes.ok) {
          const travelData = (await travelRes.json()) as {
            distanceKm?: number;
            durationMins?: number;
          };
          if (travelData.distanceKm && travelData.distanceKm > 0) {
            parsed.travel = {
              distanceKm: Math.round(travelData.distanceKm * 2 * 10) / 10,
              durationMins: (travelData.durationMins ?? 0) * 2,
              destination: parsed.destination,
            };
          }
        }
      } catch (e) {
        console.warn("[parse-job] travel lookup failed:", e);
      }
    }

    if (parsed.tasks?.length > 0) {
      const ratesForLookup = rateDtos as unknown as RateConfig[];
      /**
       * Resolves a rate label (e.g. "Standard", "At home") to its RateConfig row.
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

    // Safety net: rebalance into the largest task if the sum drifts.
    if (
      parsed.tasks?.length > 0 &&
      typeof parsed.durationMins === "number" &&
      parsed.durationMins > 0
    ) {
      // Round UP to match the calculator's billable rule (ceil to next 15-min slot).
      // Same policy as the prompt's BILLING step 2 - so the safety net + AI agree on the target.
      const targetHours = Math.ceil((parsed.durationMins / 60) * 4) / 4;
      const sumQty = parsed.tasks.reduce((s, t) => s + (t.qty || 0), 0);
      const diff = Math.round((targetHours - sumQty) * 100) / 100;
      if (Math.abs(diff) >= 0.25) {
        const largestIdx = parsed.tasks.reduce(
          (maxI, t, i, arr) => (t.qty > arr[maxI].qty ? i : maxI),
          0,
        );
        const adjusted = Math.max(
          0.25,
          Math.round((parsed.tasks[largestIdx].qty + diff) * 100) / 100,
        );
        parsed.tasks[largestIdx] = { ...parsed.tasks[largestIdx], qty: adjusted };
        parsed.warnings = [
          ...(parsed.warnings ?? []),
          `Rebalanced task quantities to match the ${targetHours}h total (added ${diff}h to "${parsed.tasks[largestIdx].description}").`,
        ];
      }
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[parse-job] failed:", err);
    return NextResponse.json({ error: "Could not parse job description" }, { status: 422 });
  }
}
