// src/features/social/lib/filters.ts
// Shared Prisma where-fragments for content items and postings. MUST be these OR shapes: on Mongo,
// `NOT` / `not` skip rows where the flag is unset, which is every row written before it existed.
// Each holds an OR, so combine two through AND rather than spreading both into one where.

/** Rows that aren't content items: posts, postings and presets. */
export const NOT_CONTENT = {
  // No `as const`: Prisma's SocialPostWhereInput needs a mutable OR array.
  OR: [{ isContent: null }, { isContent: false }, { isContent: { isSet: false } }],
};

/** Content items only. */
export const IS_CONTENT = { isContent: true };

/** Postings still following their content item: not edited by hand. */
export const NOT_DETACHED = {
  OR: [{ detached: null }, { detached: false }, { detached: { isSet: false } }],
};
