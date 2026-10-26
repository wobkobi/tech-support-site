// src/features/reviews/lib/contact-details.server.ts
// "Stay in touch" details from the review form, written into the linked contact's blank fields.

import { validateEmail } from "@/features/booking/lib/booking";
import { prisma } from "@/shared/lib/prisma";

/**
 * Fills a contact's empty email and phone from the review form. A filled field is never
 * replaced: a review link proves who the person is, not that the number on file is wrong.
 * The owner's review email shows the details either way. Never throws.
 * @param contactId - Contact the review is linked to.
 * @param details - Normalised details from the form.
 * @param details.email - Email they left, or null.
 * @param details.phone - Phone they left, or null.
 */
export async function fillBlankContactDetails(
  contactId: string,
  details: { email: string | null; phone: string | null },
): Promise<void> {
  if (!details.email && !details.phone) return;
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { email: true, phone: true },
    });
    if (!contact) return;
    const data: { email?: string; phone?: string } = {};
    if (!contact.email && details.email && validateEmail(details.email) === "ok") {
      data.email = details.email;
    }
    if (!contact.phone && details.phone) data.phone = details.phone;
    if (Object.keys(data).length > 0) {
      await prisma.contact.update({ where: { id: contactId }, data });
    }
  } catch (err) {
    console.warn(`[reviews] Couldn't save the review's contact details on ${contactId}:`, err);
  }
}
