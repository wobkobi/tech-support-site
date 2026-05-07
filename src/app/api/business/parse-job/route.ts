import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { buildParseJobPrompt } from "@/features/business/lib/prompts/parse-job";
import type { ParseJobResponse, ParseJobQuestion } from "@/features/business/types/business";

const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;

/**
 * Parses a time string (e.g. "7pm", "7:10", "10:22am") into minutes since midnight.
 * @param s - Time string to parse
 * @returns Minutes since midnight, or null if unparseable
 */
function parseTimeMins(s: string): number | null {
  const t = s.trim().toLowerCase();
  const pm = /pm/.test(t);
  const am = /am/.test(t);
  const clean = t.replace(/[apm\s]/g, "");
  const [hStr, mStr = "0"] = clean.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  if (pm) return (h === 12 ? 12 : h + 12) * 60 + m;
  if (am) return (h === 12 ? 0 : h) * 60 + m;
  return h * 60 + m;
}

/**
 * Sums all HH:MM–HH:MM segments on lines that start with a digit.
 * Handles noon crossings (12:30–1:00 = 30 min) and midnight crossings.
 * @param input - Raw job description text
 * @returns Total worked minutes, or null if no time ranges detected
 */
function calcSessionMins(input: string): number | null {
  let total = 0;
  let found = false;
  for (const line of input.split("\n")) {
    if (!/^\d/.test(line.trim())) continue;
    TIME_RANGE_RE.lastIndex = 0;
    const m = TIME_RANGE_RE.exec(line);
    if (!m) continue;
    const start = parseTimeMins(m[1]);
    const end = parseTimeMins(m[2]);
    if (start === null || end === null) continue;
    let dur = end - start;
    if (dur <= 0) {
      // Prefer the smallest positive result that fits a reasonable session (≤ 16h).
      // Adding 12h handles the common case of unmarked am/pm times crossing noon
      // (e.g. "11:25-1:20" → 115 min, not 835 min). Fall back to 24h for overnight runs.
      const withNoon = dur + 12 * 60;
      dur = withNoon > 0 && withNoon <= 16 * 60 ? withNoon : dur + 24 * 60;
    }
    total += dur;
    found = true;
  }
  return found ? total : null;
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Computes Jaccard similarity between two strings using word-token sets.
 * @param a - First string.
 * @param b - Second string.
 * @returns Similarity score between 0 and 1.
 */
function jaccardSimilarity(a: string, b: string): number {
  /**
   * Lowercases and splits a string into a set of word tokens.
   * @param s - Input string to tokenize
   * @returns Set of lowercase word tokens
   */
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(Boolean),
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns the best-matching template for a task description if similarity exceeds 0.7.
 * @param description - AI-generated task description.
 * @param templates - Available task templates from the database.
 * @returns Matching template or null if no close match found.
 */
function bestTemplateMatch(
  description: string,
  templates: { description: string }[],
): { description: string } | null {
  let best: { description: string } | null = null;
  let bestScore = 0;
  for (const t of templates) {
    const score = jaccardSimilarity(description, t.description);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 0.7 ? best : null;
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

    // Use stated round-trip distance if the AI extracted one (car travel only)
    if (!parsed.noTravelCharge && parsed.statedDistanceKm && parsed.statedDistanceKm > 0) {
      parsed.travel = {
        distanceKm: parsed.statedDistanceKm,
        durationMins: 0,
        destination: parsed.destination ?? undefined,
      };
    } else if (!parsed.noTravelCharge && parsed.destination) {
      // No stated distance - look up one-way distance via API and double for round trip
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

    // Snap task descriptions to exact template text when the AI drifts slightly
    if (templates.length > 0 && parsed.tasks?.length > 0) {
      parsed.tasks = parsed.tasks.map((task) => {
        const snap = bestTemplateMatch(task.description, templates);
        if (snap) return { ...task, description: snap.description };
        return task;
      });
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[parse-job] failed:", err);
    return NextResponse.json({ error: "Could not parse job description" }, { status: 422 });
  }
}
