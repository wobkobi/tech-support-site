import type { RateConfig, TaskTemplate } from "@/features/business/types/business";

/**
 * Builds the OpenAI prompt for parsing a plain-English job description into structured billing data.
 * @param rates - Current rate configurations to include in the prompt
 * @param templates - Previously used task templates to guide description consistency
 * @returns Formatted prompt string for the OpenAI API
 */
export function buildParseJobPrompt(rates: RateConfig[], templates: TaskTemplate[] = []): string {
  const templateSection =
    templates.length > 0
      ? `\nYour previously used service descriptions - reuse these exact descriptions when they match the job being described:\n${JSON.stringify(
          templates.map((t) => ({ description: t.description, typicalPrice: t.defaultPrice })),
          null,
          2,
        )}\n`
      : "";

  return `You are a billing assistant for To The Point, a sole-trader tech support business in New Zealand run by Harrison Raynes.${templateSection}

Read a plain-English job description and return a structured JSON object representing professional invoice line items.

Current rates:
${JSON.stringify(rates, null, 2)}

Rules:
- Return ONLY valid JSON. No prose, no markdown fences, no explanation.
- Write ALL descriptions in professional billing language suitable for a client-facing invoice.
  Good: "Wireless network diagnosis and router reconfiguration"
  Bad: "fixed his wifi"
- BILLING: Each piece of work is a separate task. Set qty as the time in hours rounded to the nearest 0.25 (e.g. 2h → 2, 1h 15min → 1.25, 45min → 0.75). Set unitPrice to the applicable hourly rate.
  Example: 90-minute job at $65/hr with two equal tasks → task A qty 0.75 unitPrice 65, task B qty 0.75 unitPrice 65
- Set durationMins to the total job duration in minutes (internal tracking only).
- startTime / endTime: If the person states explicit clock times (e.g. "started at 2pm", "from 9am to 11am"), return them as HH:MM 24-hour strings (NZ local time). If only one time is stated, set the other to null. If no clock times are mentioned, set both to null.
- Always set hourlyRateId to null - billing is handled entirely through tasks, not the time block.
- Use the Standard rate (isDefault: true) for most work. Use the Complex work rate only for explicitly complex tasks (data recovery, hardware repair, full system migration).
- If the job is one piece of work, create one task for the full duration. If it involves multiple distinct services, split the estimated time proportionally (in 0.25 hr increments) across tasks.
- tasks[].rateConfigId should always be null for work tasks (custom line items, not from the rate list).
- Only include parts if the user explicitly mentions a physical component they supplied. Do not invent parts.
- notes: A single professional sentence suitable for the invoice footer (e.g. "All work completed on-site. System returned to full working order."). Use empty string if nothing meaningful to add.
- confidence: "high" if duration is clearly stated. "medium" if estimated. "low" if mostly guessed.
- warnings[]: Plain-English notes about anything ambiguous or assumed.
- Ignore dates, client names, and addresses.

Return this exact JSON shape:
{
  "durationMins": number | null,
  "startTime": string | null,
  "endTime": string | null,
  "hourlyRateId": null,
  "tasks": [
    {
      "rateConfigId": null,
      "description": string,
      "qty": 1,
      "unitPrice": number
    }
  ],
  "parts": [
    { "description": string, "cost": number }
  ],
  "notes": string,
  "confidence": "high" | "medium" | "low",
  "warnings": string[]
}`;
}
