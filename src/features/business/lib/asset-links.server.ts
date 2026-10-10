// src/features/business/lib/asset-links.server.ts
// Database checks for an asset's expense link: the expense must exist, and must not
// already back another asset, since one expense row can only be depreciated once.
// The schema only indexes Asset.expenseId, so this is where uniqueness is enforced.

import { prisma } from "@/shared/lib/prisma";
import "server-only";

/** Why a link was refused, with the HTTP status to answer with. */
export interface LinkProblem {
  error: string;
  status: number;
}

/**
 * Checks whether an asset may link to an expense.
 * @param expenseId - Expense to link (already a valid ObjectId).
 * @param assetId - The asset being saved, so it doesn't clash with itself; null on create.
 * @returns The problem, or null when the link is fine.
 */
export async function expenseLinkProblem(
  expenseId: string,
  assetId: string | null,
): Promise<LinkProblem | null> {
  const expense = await prisma.expenseEntry.findUnique({
    where: { id: expenseId },
    select: { id: true },
  });
  if (!expense) return { error: "Linked expense not found", status: 400 };
  const other = await prisma.asset.findFirst({
    where: { expenseId, ...(assetId ? { NOT: { id: assetId } } : {}) },
    select: { name: true },
  });
  if (other) return { error: `That expense is already linked to "${other.name}"`, status: 409 };
  return null;
}
