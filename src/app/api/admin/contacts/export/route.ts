// src/app/api/admin/contacts/export/route.ts
/**
 * @description Exports all contacts as a Google Contacts-compatible CSV file.
 * Column layout matches the format produced by Google Contacts own export tool.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * Escapes a value for CSV: guards against formula injection, wraps in double
 * quotes, and escapes inner quotes.
 * @param value - The string to escape.
 * @returns CSV-safe string.
 */
function csvCell(value: string | null | undefined): string {
  let str = value ?? "";
  // Formula-injection guard: a leading =, +, -, or @ makes a spreadsheet app run
  // the cell as a formula, and contact names/addresses originate from the public
  // booking form. Prefix with a single quote so the value stays plain text.
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
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
 * GET /api/admin/contacts/export
 * Returns all contacts as a CSV file compatible with Google Contacts import.
 * Column layout mirrors the format Google Contacts produces when exporting.
 * Authenticated via X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns CSV file response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Load all live contacts
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      name: true,
      email: true,
      phone: true,
      address: true,
      altEmails: true,
      altPhones: true,
    },
  });

  // Flatten each contact's primary + alt values so the merged multi-email /
  // multi-phone data survives an export/import round-trip. Google's CSV format
  // carries alternates as repeated "E-mail N" / "Phone N" columns.
  const emailLists = contacts.map((c) =>
    [c.email, ...c.altEmails].filter((v): v is string => Boolean(v)),
  );
  const phoneLists = contacts.map((c) =>
    [c.phone, ...c.altPhones].filter((v): v is string => Boolean(v)),
  );
  const maxEmails = Math.max(1, ...emailLists.map((l) => l.length));
  const maxPhones = Math.max(1, ...phoneLists.map((l) => l.length));

  // Build the header row - email/phone column counts grow to fit the contact
  // with the most values.
  const emailHeaders: string[] = [];
  for (let i = 1; i <= maxEmails; i++) {
    emailHeaders.push(`E-mail ${i} - Label`, `E-mail ${i} - Value`);
  }
  const phoneHeaders: string[] = [];
  for (let i = 1; i <= maxPhones; i++) {
    phoneHeaders.push(`Phone ${i} - Label`, `Phone ${i} - Value`);
  }
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
    ...emailHeaders,
    ...phoneHeaders,
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

  // Build one row per contact
  const rows = contacts.map((c, idx) => {
    const { first, last } = splitName(c.name);
    const emails = emailLists[idx];
    const phones = phoneLists[idx];

    // Emit a Label/Value pair per email slot; only the first (primary) carries
    // the "* " primary marker, alternates get a blank label.
    const emailCells: string[] = [];
    for (let i = 0; i < maxEmails; i++) {
      const value = emails[i] ?? "";
      emailCells.push(csvCell(value && i === 0 ? "* " : ""), csvCell(value));
    }
    const phoneCells: string[] = [];
    for (let i = 0; i < maxPhones; i++) {
      phoneCells.push(csvCell(""), csvCell(phones[i] ?? ""));
    }

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
      csvCell("* myContacts"), // Labels - places contact in the My Contacts group
      ...emailCells,
      ...phoneCells,
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
