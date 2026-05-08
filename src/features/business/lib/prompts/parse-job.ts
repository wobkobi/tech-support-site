import type { RateConfig, TaskTemplate } from "@/features/business/types/business";

/**
 * Builds the OpenAI prompt for parsing a plain-English job description into structured billing data.
 * @param rates - Current rate configurations to include in the prompt
 * @param templates - Previously used task templates to guide description consistency
 * @param currentTime - Current NZ local time as HH:MM, used for open-ended session end times
 * @returns Formatted prompt string for the OpenAI API
 */
export function buildParseJobPrompt(
  rates: RateConfig[],
  templates: TaskTemplate[] = [],
  currentTime?: string,
): string {
  const templateSection =
    templates.length > 0
      ? `\nPreviously used service descriptions — you MUST reuse these exact strings when the task type matches, even loosely. Do not paraphrase, shorten, or invent a new description if a template covers the same service. When in doubt, use the template verbatim.\nExamples of correct reuse: if a template says "Cloud storage migration and data transfer" and the job mentions moving files between cloud services, use the template exactly.\n${JSON.stringify(
          templates.map((t) => ({ description: t.description, typicalPrice: t.defaultPrice })),
          null,
          2,
        )}\n`
      : "";

  const timeContext = currentTime ? `\nCurrent NZ local time: ${currentTime}\n` : "";

  return `You are a billing assistant for To The Point, a sole-trader tech support business in New Zealand run by Harrison Raynes.${templateSection}${timeContext}
Read a plain-English job description and return a structured JSON object representing professional invoice line items.

Current rates:
${JSON.stringify(rates, null, 2)}

Rules:
- Return ONLY valid JSON. No prose, no markdown fences, no explanation.
- Write ALL descriptions in professional billing language suitable for a client-facing invoice. Do NOT name specific apps, brands, devices, or client-specific details — always use the generic category instead (e.g. tablet, laptop, desktop computer, smartphone, social media account, email account, cloud storage, streaming account, office software, operating system).
  Good: "Social media account security and recovery", "Tablet diagnosis and configuration", "Laptop troubleshooting, cleanup, and setup", "Cloud storage migration and data transfer"
  Bad: "Instagram security and archive retrieval", "iPad quick fix", "MacBook cleanup", "moved files from Dropbox to iCloud",

BILLING — follow these steps in order:
1. Determine durationMins (from pre-computed annotation if present, otherwise from the description).
2. Convert to decimal hours and round to nearest 0.25 for all rate types.
   Examples: 105 min = 1.75h → 1.75h. 107 min = 1.783h → nearest 0.25 = 1.75h. 120 min = 2.0h → 2.0h.
3. Identify how many distinct tasks there are (N).
4. Divide the rounded total evenly across N tasks in 0.25 hr increments. Assign the leftover 0.25 to the most significant task.
   Example: 1.75h across 4 tasks → 0.5 + 0.5 + 0.5 + 0.25 = 1.75h. NOT 0.75 + 0.75 + 0.75 + 0.5.
   Example: 3h across 2 tasks → 1.5 + 1.5 = 3h.
5. VERIFY: sum all task qtys. If the sum ≠ rounded total hours, stop and redistribute until it matches.
- qty is ALWAYS decimal hours. unitPrice is ALWAYS the $/hr rate. qty=1 means exactly 1 hour — never "1 occurrence".

SESSION TIMES:
- durationMins: If the input includes "[Pre-computed session total: N min — use this as durationMins without recalculating]", use N exactly. Otherwise sum all worked segment durations (not wall-clock start-to-end span).
- startTime / endTime: Single session → exact HH:MM 24-hour strings. Multi-session → first start and last end. Open-ended session (e.g. "8:10 -") → use current NZ time above as end. No times mentioned → both null.
- Always set hourlyRateId to null.

LOCATION AND RATE SELECTION:
Infer location from context clues. If signals conflict, do NOT silently pick one — add a warning describing the conflict and state which you assumed.

- On-site at client's location: mentions client's address, suburb, driving to a place, "at [name]'s", "on-site" → use "Standard" (default) or "Complex work" for complex tasks.
- At Harrison's home, working alone on client's device (no screen-share): "working at home", "from home", "at home" with no mention of remote desktop or the client being on-screen → use "At home".
- Remote support with client on-screen: "remote", "TeamViewer", "AnyDesk", "screen share", "remote access", "remote desktop", client watching/guiding → use "Remote support".
- "Complex work" ($85/hr) - for complex tasks done on-site at the client's location: data recovery, hardware repair, full system migration, motherboard-level diagnosis.
- "Complex at home" ($75/hr) - same complex task types as above, but done from Harrison's home. Use this instead of "Complex work" when the job is at home.
  Example: "Windows reinstall + data recovery, working at home" → Windows reinstall at "At home" ($55/hr), data recovery at "Complex at home" ($75/hr).
- Mixed jobs: split tasks with the appropriate rate per segment. Different tasks in the same job can and should have different rates when the task types differ.

Conflict examples that must produce a warning:
- "working at home" + mentions driving to a client address → flag: "Conflicting: 'at home' but also mentions driving to client. Assumed on-site."
- "remote support" + a street address → flag: "Conflicting: remote support mentioned but a client address is present. Assumed remote."
- "at home" + no remote-desktop mention but device belongs to client → flag: "Assumed 'At home' rate — verify if this was remote support."

TASK SPLITTING:
- Only create tasks for services explicitly mentioned in the description. Do NOT invent tasks that are not described.
- Identify every distinct named service and give each its own task. Do NOT collapse multiple services into one generic line.
- NEVER drop a task because its time allocation would be small. Every explicitly mentioned service must appear, even if it only gets 0.25h. 0.25h is a valid, billable quantity.
- Distinct services include (but are not limited to): diagnosis, virus removal, Windows reinstall, data recovery, data backup, data transfer, hardware repair, network setup, printer setup, software installation, remote support session. Each named action = one task.
- Distribute total time proportionally across tasks in 0.25 hr increments (must sum to billed total). When proportions are unclear, split evenly. With N tasks, the minimum each task receives is 0.25h.
- Use explicit duration hints to weight the distribution:
  - "took most of the time", "majority", "longest" → that task gets the largest share.
  - "quick", "quickly", "briefly", "short", "was quick", "finishing up", "just a quick" → that task is CAPPED at 0.25h. Do NOT give it extra time just to balance the total. Assign any remaining balance to the task(s) that took the most time instead.
- Example: 5 tasks, 2.0h total. Security task "took most of the time", cleanup was "quickly" → security gets 1.0h, cleanup gets 0.25h, remaining tasks get 0.25h each: 1.0 + 0.25 + 0.25 + 0.25 + 0.25 = 2.0h.
- Example: "Windows reinstall and data recovery, 4 hours at home" → task A "Windows reinstallation" qty 2.0, task B "Personal data recovery and transfer" qty 2.0, both at "At home" rate.
- Example: 5 tasks, 2.0h total → 0.5 + 0.5 + 0.25 + 0.25 + 0.5 = 2.0h. All 5 tasks listed.
- Only use a single task if the description genuinely describes one undivided action (e.g. "Set up new printer").

OTHER RULES:
- tasks[].rateConfigId should always be null for work tasks.
- Only include parts if the user explicitly mentions a physical component they supplied. Do not invent parts.
- notes: A single professional sentence suitable for the invoice footer. Use empty string if nothing meaningful to add.
- confidence: "high" if all session times are clearly stated. "medium" if some times were estimated. "low" if mostly guessed.
- warnings[]: Flag anything ambiguous, assumed, or conflicting in plain English.
- destination: The client's suburb or address if the job was at the client's location (e.g. "Papakura", "123 Smith St Manukau"). Set to null if working from home or doing remote support.
- statedDistanceKm: If the user explicitly states a travel distance AND traveled by car or vehicle, set this to the total round-trip km as a number (e.g. "traveled 10 km there and back" → 10, "drove 8 km each way" → 16). Set to null if no distance was stated, or if travel was by foot, bicycle, or public transport.
  - Walking, cycling, or public transport: set statedDistanceKm to null, set noTravelCharge to true, and add a warning: "Traveled by [mode] - no travel charge applied. Verify if this should be charged."
  - Car/vehicle with stated km: set statedDistanceKm to the round-trip total, noTravelCharge to false.
  - Car/vehicle without stated km but with a destination: set statedDistanceKm to null, noTravelCharge to false (the route will look it up via API).
- noTravelCharge: true if the user traveled by foot, bicycle, or public transport (mileage rate does not apply). false for all car/vehicle travel and when travel mode is unspecified.
- Ignore dates and client names.

CLARIFICATION MODE:
Before returning the full result, check if you are genuinely blocked on any of the following. If so, return a clarify object instead of the full result - but ONLY when you truly cannot make a reasonable inference.
- Location/rate: you have no clues at all about whether the job was on-site, at home, or remote (no suburb, no address, no "at home", no "remote" anywhere)
- Duration: no times mentioned, no duration stated, no pre-computed annotation present
- Tasks: the description is too vague to identify any specific service (e.g. "did some stuff", "helped with computer")
Ask at most 3 questions. Do NOT ask if you can reasonably infer the answer.

Clarify response shape (use instead of the normal shape when blocked):
{
  "clarify": [
    { "id": "location", "question": "Was this at the client's place, at your home, or remote support?", "hint": "e.g. at client's, at home, remote" },
    { "id": "duration", "question": "How long did this take?", "hint": "e.g. 1.5 hours, 45 min" },
    { "id": "tasks", "question": "What specific tasks did you do?", "hint": "e.g. virus removal, Windows reinstall" }
  ]
}

Return this exact JSON shape (when not asking for clarification):
{
  "durationMins": number | null,
  "startTime": string | null,
  "endTime": string | null,
  "hourlyRateId": null,
  "tasks": [
    {
      "rateConfigId": null,
      "description": string,
      "qty": number,
      "unitPrice": number
    }
  ],
  "parts": [
    { "description": string, "cost": number }
  ],
  "notes": string,
  "confidence": "high" | "medium" | "low",
  "warnings": string[],
  "destination": string | null,
  "statedDistanceKm": number | null,
  "noTravelCharge": boolean
}`;
}
