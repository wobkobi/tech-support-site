// src/app/api/admin/contacts/export/route.ts
// Exports all contacts as a Google Contacts-compatible CSV.

import { splitName } from "@/features/contacts/lib/split-name";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * Escapes a value for CSV, guarding against formula injection.
 * @param value - The string to escape.
 * @returns CSV-safe string.
 */
function csvCell(value: string | null | undefined): string {
  let str = value ?? "";
  // A leading =, +, - or @ runs as a formula; prefix a quote (values come from the public form).
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * GET /api/admin/contacts/export
 * Returns all contacts as a CSV file compatible with Google Contacts import.
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

  // Alternates go in repeated "E-mail N" / "Phone N" columns so they survive a round trip.
  const emailLists = contacts.map((c) =>
    [c.email, ...c.altEmails].filter((v): v is string => Boolean(v)),
  );
  const phoneLists = contacts.map((c) =>
    [c.phone, ...c.altPhones].filter((v): v is string => Boolean(v)),
  );
  const maxEmails = Math.max(1, ...emailLists.map((l) => l.length));
  const maxPhones = Math.max(1, ...phoneLists.map((l) => l.length));

  // Email/phone column counts fit the contact with the most values.
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
    const { givenName: first, familyName: last } = splitName(c.name);
    const emails = emailLists[idx];
    const phones = phoneLists[idx];

    // Only the primary email gets the "* " label.
    const emailCells: string[] = [];
    for (let i = 0; i < maxEmails; i++) {
      const value = emails?.[i] ?? "";
      emailCells.push(csvCell(value && i === 0 ? "* " : ""), csvCell(value));
    }
    const phoneCells: string[] = [];
    for (let i = 0; i < maxPhones; i++) {
      phoneCells.push(csvCell(""), csvCell(phones?.[i] ?? ""));
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
