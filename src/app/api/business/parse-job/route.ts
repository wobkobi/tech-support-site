import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { buildParseJobPrompt } from "@/features/business/lib/prompts/parse-job";
import type { ParseJobResponse } from "@/features/business/types/business";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/business/parse-job - Parses a plain-English job description using gpt-4o-mini.
 * @param request - Incoming Next.js request with input string in body
 * @returns JSON with structured ParseJobResponse or a 422 error
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { input } = body;

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
    const systemPrompt = buildParseJobPrompt(rateDtos, templateDtos);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.trim() },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as ParseJobResponse;

    if (!parsed || typeof parsed !== "object") throw new Error("Invalid response shape");

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    console.error("[parse-job] failed:", err);
    return NextResponse.json({ error: "Could not parse job description" }, { status: 422 });
  }
}
