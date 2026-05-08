import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { isAdminRequest } from "@/shared/lib/auth";
import type { GoogleContact } from "@/features/business/types/business";

/**
 * GET /api/business/contacts - Returns sanitised Google Contacts for the contact picker.
 * @param request - Incoming Next.js request
 * @returns JSON with contacts array (name, email, phone, company)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: "Could not fetch contacts" }, { status: 503 });
  }
}
