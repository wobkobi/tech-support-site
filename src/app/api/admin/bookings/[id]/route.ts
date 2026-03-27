// src/app/api/admin/bookings/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API for editing and cancelling bookings by ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { deleteBookingEvent } from "@/features/calendar/lib/google-calendar";

interface PatchPayload {
  name?: string;
  email?: string;
  notes?: string;
  address?: string;
  status?: "confirmed" | "cancelled" | "completed";
}

/**
 * PATCH /api/admin/bookings/[id]
 * Updates a booking's fields. Cancelling removes the calendar event and frees the slot.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as PatchPayload;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = body.name.trim();
  if (body.email !== undefined) data.email = body.email.trim();
  if (body.notes !== undefined) data.notes = body.notes;

  if (body.address !== undefined && body.notes === undefined) {
    const currentNotes = booking.notes ?? "";
    const newAddress = body.address.trim();
    if (/^Address:\s*/im.test(currentNotes)) {
      data.notes = currentNotes.replace(/^(Address:\s*).*$/im, newAddress ? `$1${newAddress}` : "");
    }
  }

  if (body.status === "cancelled" && booking.status !== "cancelled") {
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[admin/bookings] Failed to delete calendar event:", err);
      }
    }
    data.status = "cancelled";
    data.activeSlotKey = `released:${id}`;
  } else if (body.status === "completed") {
    data.status = "completed";
    data.activeSlotKey = `released:${id}`;
  } else if (body.status === "confirmed") {
    data.status = "confirmed";
  }

  await prisma.booking.update({ where: { id }, data });

  if (body.address !== undefined && booking.email) {
    try {
      await prisma.contact.updateMany({
        where: { email: booking.email },
        data: { address: body.address.trim() || null },
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to update contact address:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/bookings/[id]
 * Permanently deletes a booking and its calendar event.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  if (booking.calendarEventId) {
    try {
      await deleteBookingEvent({ eventId: booking.calendarEventId });
    } catch (err) {
      console.error("[admin/bookings] Failed to delete calendar event:", err);
    }
  }

  await prisma.booking.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
