// src/features/contacts/lib/merge-links.ts
// What follows a contact merge. Records link to a contact by a bare contactId with no relation,
// so nothing moves on its own: the merge transaction carries these writes.

import { UNRESOLVED_CONFLICT_FILTER } from "@/features/contacts/lib/contact-conflicts";
import { optOutRepointOps } from "@/features/reviews/lib/review-ask-opt-out";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Writes that move a merged-away contact's records onto the survivor, for the merge transaction:
 * reviews, invoices, trips, promo uses, mailing sends, opt-outs and campaign exclusions. Its open
 * Google conflicts close first: their site value is the merged-away row's, so resolving one on
 * the survivor would write that stale value over the survivor's.
 * @param fromId - Contact id being merged away.
 * @param toId - The surviving contact id.
 * @returns Prisma operations to include in a `$transaction`.
 */
export async function contactRepointOps(
  fromId: string,
  toId: string,
): Promise<Prisma.PrismaPromise<unknown>[]> {
  const repoint = { where: { contactId: fromId }, data: { contactId: toId } };
  // Read now so the swap below is one write per campaign; only an unsent one still reads it.
  const excludedIn = await prisma.campaign.findMany({
    where: { excludedContactIds: { has: fromId } },
    select: { id: true, excludedContactIds: true },
  });
  return [
    prisma.review.updateMany(repoint),
    prisma.invoice.updateMany(repoint),
    prisma.trip.updateMany(repoint),
    prisma.promoRedemption.updateMany(repoint),
    prisma.campaignSend.updateMany(repoint),
    prisma.contactConflict.updateMany({
      where: { contactId: fromId, ...UNRESOLVED_CONFLICT_FILTER },
      data: { resolvedAt: new Date() },
    }),
    prisma.contactConflict.updateMany(repoint),
    ...optOutRepointOps(fromId, toId),
    ...excludedIn.map((c) =>
      prisma.campaign.update({
        where: { id: c.id },
        data: {
          excludedContactIds: {
            set: [...new Set(c.excludedContactIds.map((id) => (id === fromId ? toId : id)))],
          },
        },
      }),
    ),
  ];
}

/**
 * The survivor's merged-id list after taking in another contact: the merged-away id plus every
 * id already merged into either row, so a chain of merges still resolves in one lookup.
 * @param keeper - The surviving contact's current list.
 * @param dup - The merged-away contact's id and list.
 * @param dup.id - Its id.
 * @param dup.mergedContactIds - Ids merged into it before.
 * @returns The list to store on the survivor.
 */
export function mergedIdsAfter(
  keeper: string[],
  dup: { id: string; mergedContactIds: string[] },
): string[] {
  return [...new Set([...keeper, ...dup.mergedContactIds, dup.id])];
}

/**
 * The live contact a signed link's id belongs to now: the contact it was merged into when it
 * was merged away, else the id itself (a deleted contact's id still lands its opt-out on its
 * addresses).
 * @param contactId - Id from an unsubscribe or stop token.
 * @returns The contact id to act on.
 */
export async function followMerges(contactId: string): Promise<string> {
  const survivor = await prisma.contact.findFirst({
    where: { deletedAt: null, mergedContactIds: { has: contactId } },
    select: { id: true },
  });
  return survivor?.id ?? contactId;
}
