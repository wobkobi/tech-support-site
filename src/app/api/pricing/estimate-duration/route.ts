import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";

interface EstimateTask {
  label: string;
  mins: number;
}

interface EstimateResult {
  estimatedMins: number;
  category: "standard" | "complex";
  explanation: string;
  tasks: EstimateTask[];
}

const SYSTEM_PROMPT = `You are a tech support time estimator for a solo technician in Auckland, New Zealand.
Given a plain-English description of a tech support job, return a JSON object with exactly these fields:
- "estimatedMins": integer number of minutes for the combined visit (e.g. 60 for 1 hour, 90 for 1.5 hours)
- "category": "standard" for routine work, or "complex" for specialised/difficult work
- "explanation": one short friendly sentence explaining your estimate (e.g. "Laptop setup and data transfer typically takes around 2 hours.")
- "tasks": array of one entry per distinct task, each with "label" (short noun phrase, e.g. "Printer setup") and "mins" (integer minutes that THIS task contributes to the combined visit). The mins MUST sum to estimatedMins.

Standard jobs ($65/h): troubleshooting, general setup, software installs, tune-ups, Wi-Fi, backups, phone setup, printer setup.
Complex jobs ($85/h): data recovery, hardware repairs, PC builds, full system migrations.

STANDALONE benchmarks (time a SINGLE task would take by itself):
- Quick software fix, settings change: 30 min
- Virus removal, general tune-up: 60 min
- Phone setup (contacts, apps, email): 60 min
- Printer setup: 45 min
- Wi-Fi troubleshooting: 45 min
- New laptop setup (no data transfer): 60 min
- New laptop setup + data transfer from old laptop: 120 min
- Email / software setup: 45 min
- Hardware upgrade (RAM, SSD): 60 min
- Data recovery: 120 min
- PC build: 180 min

STACKING rules — apply when the description has MORE THAN ONE distinct task:
1. Identify the PRIMARY task (longest standalone benchmark). It contributes its FULL benchmark.
2. Each ADDITIONAL hands-on task contributes ~50% of its standalone benchmark (operator is already on-site and set up).
3. BACKGROUND tasks - data transfers, virus scans, OS/driver updates, backups, large downloads - contribute only ~15-25% of their standalone benchmark, because they run unattended while the operator works on the other tasks.
4. Sum the stacked contributions to get estimatedMins. tasks[].mins must sum to estimatedMins.

Worked example — "Fix Wi-Fi + set up new printer + transfer files from old laptop":
- Wi-Fi 45 (hands-on) -> 45 (primary)
- Printer 45 (hands-on) -> 25 (additional hands-on, ~50%)
- File transfer 120 (background copy) -> 20 (background, ~15-20%)
- estimatedMins: 90
- tasks: [{"label":"Wi-Fi troubleshooting","mins":45},{"label":"Printer setup","mins":25},{"label":"File transfer","mins":20}]

Round each task's mins to the nearest 15. Round estimatedMins to the nearest 15.
For a SINGLE task description, return exactly one entry in tasks whose mins equal estimatedMins.
Return valid JSON only. No markdown, no text outside the JSON object.`;

/**
 * Rescales tasks proportionally so their mins sum to the target total.
 * Drift gets absorbed into the largest task so visible rounding doesn't break.
 * @param tasks - Tasks returned by the AI (mutated copy returned).
 * @param target - Target total in minutes (estimatedMins).
 * @returns A new task array with mins summing exactly to target.
 */
function rebalanceTasks(tasks: EstimateTask[], target: number): EstimateTask[] {
  if (tasks.length === 0 || target <= 0) return tasks;
  const sum = tasks.reduce((s, t) => s + (t.mins || 0), 0);
  if (sum === target) return tasks;
  // Scale each task by target/sum, then snap the largest to absorb the drift.
  const scaled = tasks.map((t) => ({
    ...t,
    mins: Math.max(0, Math.round(((t.mins || 0) * target) / Math.max(1, sum) / 5) * 5),
  }));
  const scaledSum = scaled.reduce((s, t) => s + t.mins, 0);
  const diff = target - scaledSum;
  if (diff !== 0) {
    const largestIdx = scaled.reduce((maxI, t, i, arr) => (t.mins > arr[maxI].mins ? i : maxI), 0);
    scaled[largestIdx] = {
      ...scaled[largestIdx],
      mins: Math.max(0, scaled[largestIdx].mins + diff),
    };
  }
  return scaled;
}

/**
 * POST /api/pricing/estimate-duration - Estimates job duration and rate category from a plain-English description.
 * @param request - Incoming request with { description: string } body
 * @returns JSON with estimatedMins, category, explanation, and per-task split
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "estimate-duration", 5, 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const description = (body as { description?: unknown })?.description;

  if (!description || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const trimmed = description.trim().slice(0, 500);

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      max_tokens: 350,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as EstimateResult;

    if (
      typeof parsed.estimatedMins !== "number" ||
      !parsed.category ||
      !parsed.explanation ||
      !Array.isArray(parsed.tasks) ||
      parsed.tasks.length === 0
    ) {
      throw new Error("Invalid response shape");
    }

    // Defensive: trim labels, coerce mins, drop empty/garbage entries.
    const cleanTasks: EstimateTask[] = parsed.tasks
      .map((t) => ({
        label: typeof t?.label === "string" ? t.label.trim().slice(0, 80) : "",
        mins: Math.max(0, Math.round(Number(t?.mins) || 0)),
      }))
      .filter((t) => t.label.length > 0);

    if (cleanTasks.length === 0) {
      cleanTasks.push({ label: "Tech support", mins: parsed.estimatedMins });
    }

    parsed.tasks = rebalanceTasks(cleanTasks, parsed.estimatedMins);

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[estimate-duration] failed:", err);
    return NextResponse.json({ error: "Could not estimate duration" }, { status: 422 });
  }
}
