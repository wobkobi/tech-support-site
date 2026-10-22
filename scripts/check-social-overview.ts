// scripts/check-social-overview.ts
// Social Overview: the set-up list's steps, counts and skipping, the short day labels the next
// seven days use, and what each app can do: per-feature status, the token warning's thresholds
// and reading debug_token. Pure logic, no DB.
// Run with: npm test -- social-overview

import { shortDay } from "@/features/social/lib/calendar";
import {
  CHECKLIST_ITEMS,
  CHECKLIST_KEYS,
  checklistOf,
  isChecklistKey,
  type ChecklistFacts,
} from "@/features/social/lib/checklist";
import {
  cellStatus,
  coreReady,
  FEATURES,
  featureStatus,
  TOKEN_WARN_DAYS,
  tokenInfoOf,
  tokenWarning,
  type MetaTokenInfo,
  type Permissions,
} from "@/features/social/lib/permissions";
import { expect, expectEqual, finish } from "./lib/harness.js";

const NOTHING: ChecklistFacts = {
  connected: 0,
  brand: false,
  items: 0,
  schedules: 0,
  recycling: false,
  emailed: false,
  permissions: false,
};

const EVERYTHING: ChecklistFacts = {
  connected: 3,
  brand: true,
  items: CHECKLIST_ITEMS,
  schedules: 1,
  recycling: true,
  emailed: true,
  permissions: true,
};

/** Steps, counts, skipping and the done rules. */
function checkChecklist(): void {
  const empty = checklistOf(NOTHING, []);
  expectEqual(
    "every step, in order",
    empty.steps.map((s) => s.key),
    [...CHECKLIST_KEYS],
  );
  expectEqual("nothing done", empty.done, 0);
  expectEqual("every step counted", empty.total, CHECKLIST_KEYS.length);
  expect("not complete", !empty.complete);

  const full = checklistOf(EVERYTHING, []);
  expectEqual("all done", full.done, CHECKLIST_KEYS.length);
  expect("complete", full.complete);

  /**
   * Whether one step is done, with every other fact at nothing.
   * @param facts - The facts to set.
   * @param key - The step.
   * @returns Its done flag.
   */
  const doneOf = (facts: Partial<ChecklistFacts>, key: string): boolean | undefined =>
    checklistOf({ ...NOTHING, ...facts }, []).steps.find((s) => s.key === key)?.done;
  expect("two of three apps isn't connected", doneOf({ connected: 2 }, "connect") === false);
  expect("three apps is", doneOf({ connected: 3 }, "connect") === true);
  expect("still checking isn't", doneOf({ connected: null }, "connect") === false);
  expect(
    "one short of the items isn't",
    doneOf({ items: CHECKLIST_ITEMS - 1 }, "content") === false,
  );
  expect("more than enough items is", doneOf({ items: CHECKLIST_ITEMS + 4 }, "content") === true);
  expect("one schedule is enough", doneOf({ schedules: 1 }, "schedule") === true);
  expect("brand", doneOf({ brand: true }, "brand") === true);
  expect("recycling", doneOf({ recycling: true }, "recycle") === true);
  expect("email", doneOf({ emailed: true }, "email") === true);
  expect("permissions", doneOf({ permissions: true }, "permissions") === true);
  expect(
    "still checking permissions isn't",
    doneOf({ permissions: null }, "permissions") === false,
  );

  const checking = checklistOf({ ...NOTHING, connected: null }, []);
  expect(
    "checking says so",
    checking.steps[0]!.detail.startsWith("Checking"),
    checking.steps[0]!.detail,
  );
  expect(
    "a count says how many",
    checklistOf({ ...NOTHING, connected: 2 }, []).steps[0]!.detail.startsWith("2 of 3"),
  );
  expect(
    "one item reads as one",
    checklistOf({ ...NOTHING, items: 1 }, []).steps[2]!.detail.startsWith("1 item so far"),
  );

  // Skipped steps stay in the list but leave the counts.
  const skipped = checklistOf({ ...NOTHING, brand: true }, ["brand", "email"]);
  expectEqual("skipped steps still listed", skipped.steps.length, CHECKLIST_KEYS.length);
  expectEqual(
    "marked skipped",
    skipped.steps.filter((s) => s.skipped).map((s) => s.key),
    ["brand", "email"],
  );
  expectEqual("skipped leave the total", skipped.total, CHECKLIST_KEYS.length - 2);
  expectEqual("a done step skipped isn't counted done", skipped.done, 0);

  const rest = checklistOf(
    {
      ...NOTHING,
      connected: 3,
      items: CHECKLIST_ITEMS,
      schedules: 2,
      recycling: true,
      permissions: true,
    },
    ["brand", "email"],
  );
  expect("complete once everything not skipped is done", rest.complete);

  const allSkipped = checklistOf(NOTHING, [...CHECKLIST_KEYS]);
  expectEqual("all skipped counts nothing", allSkipped.total, 0);
  expect("all skipped is complete", allSkipped.complete);

  expect("unknown skip ignored", checklistOf(NOTHING, ["nope"]).total === CHECKLIST_KEYS.length);

  expect("a key is a key", isChecklistKey("schedule"));
  expect("an unknown word isn't", !isChecklistKey("nope"));
  expect("a number isn't", !isChecklistKey(3));
  expect("nothing isn't", !isChecklistKey(undefined));
}

/** Short day labels, at month and year edges. */
function checkShortDay(): void {
  expectEqual("a Thursday", shortDay("2026-10-22"), "Thu 22");
  expectEqual("a Monday", shortDay("2026-10-26"), "Mon 26");
  expectEqual("first of the month, no leading zero", shortDay("2026-11-01"), "Sun 1");
  expectEqual("new year's eve", shortDay("2026-12-31"), "Thu 31");
  expectEqual("new year", shortDay("2027-01-01"), "Fri 1");
  expectEqual("leap day", shortDay("2028-02-29"), "Tue 29");
}

/** The live token's scopes on 2026-10-22: posting and Instagram take-downs, nothing else. */
const POSTING_SCOPES = [
  "pages_show_list",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_manage_contents",
  "public_profile",
];

/** Every scope any feature asks for. */
const ALL_SCOPES = FEATURES.flatMap((f) =>
  Object.values(f.needs).flatMap((n) => (n && "scopes" in n ? [...n.scopes] : [])),
);

/**
 * A working token with the given scopes.
 * @param scopes - Its permissions.
 * @param dates - Expiry dates to set.
 * @returns Token details.
 */
function tokenWith(scopes: string[], dates: Partial<MetaTokenInfo> = {}): MetaTokenInfo {
  return {
    valid: true,
    type: "PAGE",
    app: "Test app",
    scopes,
    expiresAt: null,
    dataAccessExpiresAt: null,
    error: null,
    ...dates,
  };
}

/**
 * Permissions with every app set up and every Google API answering.
 * @param token - The Meta token.
 * @returns The facts.
 */
function permsWith(token: MetaTokenInfo | null): Permissions {
  return {
    setUp: { facebook: true, instagram: true, google: true },
    token,
    tokenError: null,
    google: { posts: { ok: true }, reviews: { ok: true }, performance: { ok: true } },
  };
}

/** Feature cells, the set-up list's readiness, the token warning and reading debug_token. */
function checkPermissions(): void {
  const today = permsWith(tokenWith(POSTING_SCOPES));
  const publish = featureStatus("publish", today);
  expectEqual("Facebook can post", publish.facebook.state, "ready");
  expectEqual("Instagram can post", publish.instagram.state, "ready");
  expectEqual("Google can post", publish.google.state, "ready");
  expectEqual(
    "Instagram take-down ready",
    featureStatus("takedown", today).instagram.state,
    "ready",
  );

  const stats = featureStatus("stats", today);
  expectEqual(
    "Facebook stats name what's missing",
    stats.facebook.state === "missing" ? stats.facebook.missing : null,
    ["read_insights"],
  );
  expectEqual(
    "Instagram stats name only what's missing",
    stats.instagram.state === "missing" ? stats.instagram.missing : null,
    ["instagram_manage_insights"],
  );
  expectEqual("Facebook comments need both", featureStatus("comments", today).facebook, {
    state: "missing",
    missing: ["pages_read_user_content", "pages_manage_engagement"],
  });
  expectEqual("no Instagram cover", featureStatus("cover", today).instagram.state, "none");
  expectEqual("no Google messages", featureStatus("messages", today).google.state, "none");

  expectEqual("still checking", featureStatus("publish", null).facebook.state, "checking");
  expectEqual("not offered while checking", featureStatus("cover", null).google.state, "none");

  const offGoogle: Permissions = {
    ...permsWith(tokenWith(ALL_SCOPES)),
    google: {
      posts: { ok: true },
      reviews: { ok: true },
      performance: { ok: false, error: "Turn it on." },
    },
  };
  expectEqual("an API that's off says why", featureStatus("stats", offGoogle).google, {
    state: "off",
    reason: "Turn it on.",
  });
  expectEqual(
    "its other features still work",
    featureStatus("comments", offGoogle).google.state,
    "ready",
  );

  const noInstagram: Permissions = {
    ...permsWith(tokenWith(ALL_SCOPES)),
    setUp: { facebook: true, instagram: false, google: true },
  };
  expectEqual("an app without its keys", featureStatus("publish", noInstagram).instagram, {
    state: "off",
    reason: "Not set up.",
  });
  expectEqual(
    "Google not set up",
    cellStatus({ probe: "posts" }, "google", { ...today, google: null }),
    {
      state: "off",
      reason: "Not set up.",
    },
  );

  const unread: Permissions = { ...permsWith(null), tokenError: "Meta said no." };
  expectEqual("an unreadable token says why", featureStatus("publish", unread).facebook, {
    state: "off",
    reason: "Meta said no.",
  });
  expectEqual(
    "a dead token blocks every Meta feature",
    featureStatus("publish", permsWith({ ...tokenWith(ALL_SCOPES), valid: false })).instagram.state,
    "off",
  );

  expectEqual("posting scopes aren't enough for the list", coreReady(today), false);
  expectEqual("every scope and API is", coreReady(permsWith(tokenWith(ALL_SCOPES))), true);
  expectEqual("an API off isn't", coreReady(offGoogle), false);
  expectEqual("unknown while checking", coreReady(null), null);

  // Warnings: stopped working, then running out, then data access ending, each within the window.
  const now = new Date("2026-10-22T00:00:00Z");
  /**
   * A time some days after now.
   * @param days - How many days on.
   * @returns ISO time.
   */
  const inDays = (days: number): string =>
    new Date(now.getTime() + days * 86_400_000).toISOString();
  expectEqual("no token, no warning", tokenWarning(null, now), null);
  expectEqual("a token that never runs out", tokenWarning(tokenWith([]), now), null);
  expectEqual(
    "dead is critical",
    tokenWarning({ ...tokenWith([]), valid: false }, now)?.tone,
    "critical",
  );
  expectEqual(
    "runs out inside the window",
    tokenWarning(tokenWith([], { expiresAt: inDays(TOKEN_WARN_DAYS) }), now)?.tone,
    "warning",
  );
  expectEqual(
    "a day past the window is fine",
    tokenWarning(tokenWith([], { expiresAt: inDays(TOKEN_WARN_DAYS + 1) }), now),
    null,
  );
  const dataSoon = tokenWarning(tokenWith([], { dataAccessExpiresAt: inDays(3) }), now);
  expect(
    "data access ending warns",
    dataSoon?.text.startsWith("Meta stops") === true,
    dataSoon?.text,
  );
  expect("names the day", dataSoon?.text.includes("25 Oct 2026") === true, dataSoon?.text);
  expectEqual(
    "data access 72 days out is fine",
    tokenWarning(tokenWith([], { dataAccessExpiresAt: "2027-01-03T05:31:37.000Z" }), now),
    null,
  );

  // debug_token answers in seconds, with 0 for never.
  expectEqual(
    "reads a live answer",
    tokenInfoOf({
      is_valid: true,
      type: "PAGE",
      application: "To the Point Posting",
      scopes: ["pages_manage_posts"],
      expires_at: 0,
      data_access_expires_at: 1798954297,
    }),
    {
      valid: true,
      type: "PAGE",
      app: "To the Point Posting",
      scopes: ["pages_manage_posts"],
      expiresAt: null,
      dataAccessExpiresAt: "2027-01-03T05:31:37.000Z",
      error: null,
    },
  );
  const dead = tokenInfoOf({ is_valid: false, error: { message: "Session expired" } });
  expect("an empty answer is invalid", !tokenInfoOf({}).valid);
  expectEqual("keeps Meta's reason", dead.error, "Session expired");
}

checkChecklist();
checkShortDay();
checkPermissions();
finish();
