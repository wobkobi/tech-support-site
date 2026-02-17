// src/app/api/cron/send-review-emails/route.ts
/**
 * @file route.ts
 * @description Cron job that sends review request emails 1 hour after appointments.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Verify the request is from Vercel Cron or has the correct secret.
 * @param request - The incoming request to verify.
 * @returns True if authorized, false otherwise.
 */
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return request.headers.has("x-vercel-cron");
  }

  return request.headers.has("x-vercel-cron") || authHeader === `Bearer ${cronSecret}`;
}

/**
 * Sends review request email
 * @param booking - Booking details
 * @param booking.id - Booking ID
 * @param booking.name - Customer name
 * @param booking.email - Customer email
 * @param booking.reviewToken - Unique review token
 * @returns Promise that resolves when email is sent
 */
async function sendReviewEmail(booking: {
  id: string;
  name: string;
  email: string;
  reviewToken: string;
}): Promise<void> {
  // TODO: Integrate with your email provider (nodemailer is already in package.json)
  const reviewUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/review?token=${booking.reviewToken}`;

  console.log(`[review-email] Would send to ${booking.email}:`);
  console.log(`  Name: ${booking.name}`);
  console.log(`  Review URL: ${reviewUrl}`);

  // Example with nodemailer (uncomment when ready):
  /*
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    // Your email config
  });
  
  await transporter.sendMail({
    from: '"To The Point Tech" <harrison@tothepoint.co.nz>',
    to: booking.email,
    subject: "How was your tech support appointment?",
    html: `
      <p>Hi ${booking.name},</p>
      <p>Thanks for choosing To The Point Tech! I hope I was able to help with your tech issue.</p>
      <p>If you have a moment, I'd really appreciate your feedback:</p>
      <p><a href="${reviewUrl}">Leave a review</a></p>
      <p>Your review helps other locals find reliable tech support.</p>
      <p>Thanks,<br>Harrison</p>
    `,
  });
  */
}

/**
 * GET /api/cron/send-review-emails
 * Finds completed appointments from 1 hour ago and sends review requests
 * @param request - The incoming cron request
 * @returns JSON response with results
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Find bookings that:
    // 1. Ended between 2 hours ago and 1 hour ago
    // 2. Are confirmed
    // 3. Haven't had review email sent yet
    const bookingsToEmail = await prisma.booking.findMany({
      where: {
        endUtc: {
          gte: twoHoursAgo,
          lte: oneHourAgo,
        },
        status: "confirmed",
        reviewSentAt: null, // Haven't sent review email yet
      },
      select: {
        id: true,
        name: true,
        email: true,
        reviewToken: true,
      },
    });

    const results = {
      found: bookingsToEmail.length,
      sent: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const booking of bookingsToEmail) {
      try {
        await sendReviewEmail(booking);

        // Mark as sent
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            reviewSentAt: now,
          },
        });

        results.sent++;
      } catch (error) {
        console.error(`[review-email] Failed for booking ${booking.id}:`, error);
        results.failed++;
        results.errors.push(`Booking ${booking.id}: ${error}`);
      }
    }

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error) {
    console.error("[review-email] Cron error:", error);
    return NextResponse.json({ ok: false, error: "Failed to send review emails" }, { status: 500 });
  }
}
