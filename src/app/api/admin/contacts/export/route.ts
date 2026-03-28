// src/app/api/admin/contacts/export/route.ts
/**
 * @file route.ts
 * @description Exports all contacts as a Google Contacts-compatible CSV file.
 * Column layout matches the format produced by Google Contacts own export tool.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";

/**
 * Escapes a value for CSV: wraps in double quotes and escapes inner quotes.
 * @param value - The string to escape.
 * @returns CSV-safe string.
 */
function csvCell(value: string | null | undefined): string {
  const str = value ?? "";
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Splits a full display name into first and last name parts.
 * Everything before the last word is the first name; the last word is the last name.
 * @param fullName - Full display name.
 * @returns Object with first and last name strings.
 */
function splitName(fullName: string): { first: string; last: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/**
 * GET /api/admin/contacts/export?token=<ADMIN_SECRET>
 * Returns all contacts as a CSV file compatible with Google Contacts import.
 * Column layout mirrors the format Google Contacts produces when exporting.
 * @param request - Incoming request.
 * @returns CSV file response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  if (!isValidAdminToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { name: true, email: true, phone: true, address: true },
  });

  const headers = [
    "First Name",
    "Middle Name",
    "Last Name",
    "Phonetic First Name",
    "Phonetic Middle Name",
    "Phonetic Last Name",
    "Name Prefix",
    "Name Suffix",
    "Nickname",
    "File As",
    "Organization Name",
    "Organization Title",
    "Organization Department",
    "Birthday",
    "Notes",
    "Photo",
    "Labels",
    "E-mail 1 - Label",
    "E-mail 1 - Value",
    "Phone 1 - Label",
    "Phone 1 - Value",
    "Address 1 - Label",
    "Address 1 - Formatted",
    "Address 1 - Street",
    "Address 1 - City",
    "Address 1 - PO Box",
    "Address 1 - Region",
    "Address 1 - Postal Code",
    "Address 1 - Country",
    "Address 1 - Extended Address",
  ];

  const rows = contacts.map((c) => {
    const { first, last } = splitName(c.name);
    return [
      csvCell(first), // First Name
      csvCell(""), // Middle Name
      csvCell(last), // Last Name
      csvCell(""), // Phonetic First Name
      csvCell(""), // Phonetic Middle Name
      csvCell(""), // Phonetic Last Name
      csvCell(""), // Name Prefix
      csvCell(""), // Name Suffix
      csvCell(""), // Nickname
      csvCell(""), // File As
      csvCell(""), // Organization Name
      csvCell(""), // Organization Title
      csvCell(""), // Organization Department
      csvCell(""), // Birthday
      csvCell(""), // Notes
      csvCell(""), // Photo
      csvCell("* myContacts"), // Labels — places contact in the My Contacts group
      csvCell(c.email ? "* " : ""), // E-mail 1 - Label (* = primary)
      csvCell(c.email), // E-mail 1 - Value
      csvCell(""), // Phone 1 - Label
      csvCell(c.phone), // Phone 1 - Value
      csvCell(""), // Address 1 - Label
      csvCell(c.address), // Address 1 - Formatted
      csvCell(""), // Address 1 - Street
      csvCell(""), // Address 1 - City
      csvCell(""), // Address 1 - PO Box
      csvCell(""), // Address 1 - Region
      csvCell(""), // Address 1 - Postal Code
      csvCell(""), // Address 1 - Country
      csvCell(""), // Address 1 - Extended Address
    ].join(",");
  });

  // UTF-8 BOM required for Google Contacts to correctly parse the CSV encoding
  const bom = "\uFEFF";
  const csv = bom + [headers.join(","), ...rows].join("\r\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts.csv"`,
    },
  });
}
