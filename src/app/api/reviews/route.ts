// src/app/api/reviews/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { text, firstName, lastName, isAnonymous } = await req.json();

  const t = typeof text === "string" ? text.trim() : "";
  const f = typeof firstName === "string" ? firstName.trim() : null;
  const l = typeof lastName === "string" ? lastName.trim() : null;
  const anon = Boolean(isAnonymous);

  if (!t) return NextResponse.json({ error: "Text required" }, { status: 400 });
  if (!anon && !f) {
    return NextResponse.json({ error: "First name required" }, { status: 400 });
  }

  await prisma.review.create({
    data: {
      text: t,
      firstName: anon ? null : f,
      lastName: anon ? null : l,
      isAnonymous: anon,
      approved: false, // moderation gate
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
