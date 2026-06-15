import type { GoogleContact } from "@/features/business/types/business";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/business/contacts - Returns sanitised Google Contacts for the contact picker.
 * @param request - Incoming Next.js request
 * @returns JSON with contacts array (name, email, phone, company)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const auth = getOAuth2Client();
    const people = google.people({ version: "v1", auth });

    const res = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: 100,
      personFields: "names,emailAddresses,phoneNumbers,organizations",
    });

    const connections = res.data.connections ?? [];

    const contacts: GoogleContact[] = connections
      .map((person) => ({
        id: person.resourceName ?? "",
        name: person.names?.[0]?.displayName ?? person.names?.[0]?.givenName ?? "",
        email: person.emailAddresses?.[0]?.value ?? "",
        phone: person.phoneNumbers?.[0]?.value ?? "",
        company: person.organizations?.[0]?.name ?? "",
      }))
      .filter((c) => c.id && (c.name || c.email));

    return NextResponse.json({ ok: true, contacts });
  } catch (err) {
    console.error("[contacts] failed:", err);
    return errorResponse("Could not fetch contacts", 503);
  }
}
