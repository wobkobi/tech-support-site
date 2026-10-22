// scripts/eval-ai/index.ts
// On-demand black-box eval of the AI routes against a running dev server.
// Usage:
//   npm run eval:ai -- --self-test        # pure checks, no server, no API calls
//   npm run eval:ai                       # full run against http://localhost:3000
//   npm run eval:ai -- --url=http://localhost:3001
//   npm run eval:ai -- --runs=3           # repeat each case 3x for reproducibility
//   npm run eval:ai -- --only=zero-length,walk-plus   # just the cases whose id contains one

import { clampBillableMins } from "@/features/business/lib/pricing-policy";
import { calcSessionMins } from "@/features/business/lib/time-parse";
import { parseCaptionRequest, type CaptionRequest } from "@/features/social/lib/caption-ai";
import { avoidList } from "@/shared/lib/ai/brand-rules";
import { parseHashtags } from "@/shared/lib/hashtags";
import {
  captionProblems,
  draftProblems,
  estimateTolerance,
  expectedEstimateMins,
  postDraftProblems,
  spread,
  withinTolerance,
  type CheckResult,
} from "./assert";
import type { LiveContext } from "./context";

// Record an errored case and carry on; three in a row means the API is down, so abort.
const MAX_CONSECUTIVE_ERRORS = 3;

/** One assertion check with expected/actual values, hardcoded - no network. */
interface SelfCase {
  name: string;
  got: number | boolean | null;
  want: number | boolean | null;
}

/** Raw results for one case across N runs. */
interface RawRun {
  id: string;
  kind: "estimate-single" | "estimate-multi" | "parse" | "cross-route" | "travel" | "draft";
  benchmarkLabel?: string;
  /** Raw input text (parse + cross-route) - the auditor re-derives the canonical duration from it. */
  input?: string;
  /** Parse cases: "exact" hard-asserts, "info" is report-only. */
  expectMode?: "exact" | "info";
  /** Cross-route cases: the parse-job durationMins for the same input. */
  parseMins?: number;
  /** Travel cases: the decision the route returned, and what was expected. */
  travel?: {
    gotDestination: string | null;
    gotNoTravelCharge: boolean | null;
    wantDestination: string | null;
    wantNoTravelCharge: boolean;
    gotStoreRuns: string[];
    wantStoreRuns?: string[];
    why: string;
  };
  /** Draft cases: what broke the shared rules (hard, soft) and the case's own forbid list. */
  draftCheck?: { hard: string[]; soft: string[] };
  /** Set when live data can't exercise the case (no Never mention words); reported as a skip. */
  skip?: string;
  durations: number[];
  first: unknown;
  /** Set when the case could not complete; reported as a hard fail, no checks run. */
  error?: string;
}

/** A draft that breaks no rule, for the self-test to vary one field at a time. */
const SAMPLE_DRAFT = {
  subject: "Home visits out west",
  preheader: "Tuesdays and Thursdays.",
  heading: "Now visiting Titirangi",
  paragraphs: ["I'm now coming out to Titirangi."],
  bullets: [],
  buttonText: "Book a time",
  buttonUrl: "",
  picture: "" as const,
};

/** A post maker draft that breaks no rule, and the room it was written for. */
const SAMPLE_POST = {
  headline: "Home visits in Titirangi",
  support: "Tuesdays and Thursdays, at your place.",
  bullets: [],
  quote: "",
  name: "",
  caption: "I'm now coming out to Titirangi.",
};
const SAMPLE_ROOM = { headline: true, support: true, bullets: 0, quote: false, name: false };

/**
 * A parsed caption request for the self-test: one option for Facebook with every switch off,
 * unless `over` sets it.
 * @param over - Request fields to set.
 * @returns The request.
 */
function sampleCaptionReq(over: Record<string, unknown> = {}): CaptionRequest {
  const req = parseCaptionRequest({
    brief: "Home visits in Titirangi",
    count: 1,
    platforms: ["facebook"],
    ...over,
  });
  if ("error" in req) throw new Error(req.error);
  return req;
}
const NO_BRAND = { tags: [], avoid: [] };

/**
 * Runs the network-free pure-logic checks and reports pass/fail.
 * @returns Process exit code (0 all pass, 1 any fail).
 */
function runSelfTest(): number {
  const cases: SelfCase[] = [
    // 480 is the self-test's hardcoded ceiling; live runs use settings.maxJobMins.
    { name: "estimate snaps to benchmark", got: expectedEstimateMins(45, 30, 15, 480), want: 45 },
    {
      name: "estimate floors to min-billable",
      got: expectedEstimateMins(10, 30, 15, 480),
      want: 30,
    },
    { name: "estimate caps at ceiling", got: expectedEstimateMins(500, 30, 15, 480), want: 480 },
    { name: "tolerance is >=1 increment", got: estimateTolerance(45, 15), want: 15 },
    { name: "within tolerance true", got: withinTolerance(88, 90, 15), want: true },
    { name: "within tolerance false", got: withinTolerance(70, 90, 15), want: false },
    { name: "spread of identical is 0", got: spread([90, 90, 90]), want: 0 },
    { name: "spread reports range", got: spread([90, 105]), want: 15 },
    // Canonical time-parse truths (human-verified) - the auditor's independent
    // correctness, NOT a mirror of route output.
    { name: "canonical 9am-5pm", got: calcSessionMins("9am-5pm\nx"), want: 480 },
    { name: "canonical bare 9-5 is 8h", got: calcSessionMins("9-5\nx"), want: 480 },
    { name: "canonical 9-11am", got: calcSessionMins("9-11am\nx"), want: 120 },
    { name: "canonical overnight 11pm-1am", got: calcSessionMins("11pm-1am\nx"), want: 120 },
    { name: "canonical noon boundary 12am-12pm", got: calcSessionMins("12am-12pm\nx"), want: 720 },
    { name: "canonical 'to' separator", got: calcSessionMins("9 to 11am\nx"), want: 120 },
    { name: "canonical space separator", got: calcSessionMins("9 11am\nx"), want: 120 },
    {
      name: "canonical non-digit-led is null",
      got: calcSessionMins("fix wifi 9-11am"),
      want: null,
    },
    // Shared clamp truths.
    { name: "clamp caps at ceiling", got: clampBillableMins(500, 15, 5, 480), want: 480 },
    { name: "clamp floors zero to min", got: clampBillableMins(0, 15, 5), want: 15 },
    { name: "clamp survives zero increment", got: clampBillableMins(47, 15, 0), want: 45 },
    // Draft rule truths.
    {
      name: "clean draft has no problems",
      got: draftProblems(SAMPLE_DRAFT, "").hard.length,
      want: 0,
    },
    {
      name: "em dash is a hard problem",
      got: draftProblems({ ...SAMPLE_DRAFT, heading: "Out west \u2014 now" }, "").hard.length,
      want: 1,
    },
    {
      name: "figure from the brief is fine",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["It's $65."] }, "$65 an hour").hard.length,
      want: 0,
    },
    {
      name: "invented figure is a hard problem",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["It's $65."] }, "").hard.length,
      want: 1,
    },
    {
      name: "figure from the business facts is fine",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["It's $65."] }, "", "- Rate: $65/hr").hard
        .length,
      want: 0,
    },
    {
      name: "facts match whole numbers only",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["By the 31st."] }, "", "Phone: 021 1237")
        .hard.length,
      want: 1,
    },
    {
      name: "placeholder digits don't count",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["{promoOffer}"] }, "").hard.length,
      want: 0,
    },
    {
      name: "greeting in the first paragraph is a hard problem",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["Hi there, news."] }, "").hard.length,
      want: 1,
    },
    {
      name: '"our" in a heading is a hard problem',
      got: draftProblems({ ...SAMPLE_DRAFT, heading: "Our mailing list" }, "").hard.length,
      want: 1,
    },
    {
      name: '"we" in a quoted scam text is fine',
      got: draftProblems(
        { ...SAMPLE_DRAFT, bullets: ['Texts saying "we couldn\'t deliver your parcel"'] },
        "",
      ).hard.length,
      want: 0,
    },
    {
      name: '"US" the country is fine',
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["Calls from US numbers."] }, "").hard
        .length,
      want: 0,
    },
    {
      name: "curly quote is soft only",
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["It\u2019s here."] }, "").soft.length,
      want: 1,
    },
    {
      name: "clean post draft has no problems",
      got: postDraftProblems(SAMPLE_POST, "", SAMPLE_ROOM, false).hard.length,
      want: 0,
    },
    {
      name: "a phone number on the picture is a hard problem",
      got: postDraftProblems(
        { ...SAMPLE_POST, support: "Call 021 123 4567" },
        "021 123 4567",
        SAMPLE_ROOM,
        false,
      ).hard.length,
      want: 1,
    },
    {
      name: "a booking address in a paid ad's words is a hard problem",
      got: postDraftProblems(
        { ...SAMPLE_POST, caption: "Book at https://example.co.nz/booking" },
        "",
        SAMPLE_ROOM,
        true,
      ).hard.length,
      want: 1,
    },
    {
      name: '"our" on the picture is a hard problem',
      got: postDraftProblems(
        { ...SAMPLE_POST, headline: "New: our mailing list" },
        "",
        SAMPLE_ROOM,
        false,
      ).hard.length,
      want: 1,
    },
    {
      name: '"we" in a single-quoted scam text is fine',
      got: draftProblems(
        { ...SAMPLE_DRAFT, bullets: ["Texts saying 'we couldn't deliver your parcel'."] },
        "",
      ).hard.length,
      want: 0,
    },
    {
      name: '"our" after an apostrophe is still a hard problem',
      got: draftProblems({ ...SAMPLE_DRAFT, paragraphs: ["I'm here and it's our list."] }, "").hard
        .length,
      want: 1,
    },
    {
      name: '"we" in a customer\'s quote is fine',
      got: postDraftProblems(
        { ...SAMPLE_POST, quote: "We were stuck" },
        "We were stuck",
        SAMPLE_ROOM,
        false,
      ).hard.length,
      want: 0,
    },
    {
      name: "a quote not in the brief is a hard problem",
      got: postDraftProblems(
        { ...SAMPLE_POST, quote: "Best in Auckland" },
        "Fixed my printer",
        SAMPLE_ROOM,
        false,
      ).hard.length,
      want: 1,
    },
    {
      name: "clean caption has no problems",
      got: captionProblems(["I'm now visiting Titirangi."], sampleCaptionReq(), "", NO_BRAND).hard
        .length,
      want: 0,
    },
    {
      name: "a hashtag with hashtags off is a hard problem",
      got: captionProblems(
        ["I'm now visiting Titirangi.\n\n#Titirangi"],
        sampleCaptionReq(),
        "",
        NO_BRAND,
      ).hard.length,
      want: 1,
    },
    {
      name: "brand hashtags that don't come first are a hard problem",
      got: captionProblems(
        ["I'm now visiting Titirangi.\n\n#Titirangi #AucklandTech"],
        sampleCaptionReq({ hashtags: true }),
        "",
        { tags: ["AucklandTech"], avoid: [] },
      ).hard.length,
      want: 1,
    },
    {
      name: "a phone number in words for Google is a hard problem",
      got: captionProblems(
        ["Give me a call on 021 123 4567."],
        sampleCaptionReq({ brief: "Call me on 021 123 4567", platforms: ["google"] }),
        "",
        NO_BRAND,
      ).hard.length,
      want: 1,
    },
    {
      name: "the booking link twice is a hard problem",
      got: captionProblems(
        ["Book at https://example.nz/booking or https://example.nz/booking."],
        sampleCaptionReq({ ending: "book" }),
        "",
        NO_BRAND,
      ).hard.length,
      want: 1,
    },
    {
      name: "a fix that keeps the post's emoji and hashtags is clean",
      got: captionProblems(
        ["I'm here 🙂 #Titirangi"],
        sampleCaptionReq({ mode: "rewrite", action: "fix", brief: "Im here 🙂 #Titirangi" }),
        "",
        NO_BRAND,
      ).hard.length,
      want: 0,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const ok = c.got === c.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${c.name} (got ${c.got}, want ${c.want})`,
    );
  }
  console.log(
    failed === 0
      ? `\n✓ ${cases.length} self-tests passed\n`
      : `\n✗ ${failed} self-test(s) failed\n`,
  );
  return failed === 0 ? 0 : 1;
}

/**
 * Parses `--flag=value` / `--flag` CLI arguments.
 * @returns Parsed flags with defaults applied.
 */
function parseArgs(): {
  selfTest: boolean;
  url: string;
  runs: number;
  probe: boolean;
  showContext: boolean;
  only: string[];
} {
  const args = process.argv.slice(2);
  let selfTest = false;
  let url = "http://localhost:3000";
  let runs = 2;
  let probe = false;
  let showContext = false;
  let only: string[] = [];
  for (const arg of args) {
    if (arg === "--self-test") selfTest = true;
    else if (arg.startsWith("--url=")) url = arg.slice(6);
    else if (arg.startsWith("--runs=")) runs = Math.max(1, parseInt(arg.slice(7), 10) || 1);
    else if (arg === "--probe") probe = true;
    else if (arg === "--show-context") showContext = true;
    else if (arg.startsWith("--only=")) only = arg.slice(7).split(",").filter(Boolean);
  }
  return { selfTest, url, runs, probe, showContext, only };
}

/**
 * Runs one case `runs` times, collecting each run's number and the first run's result.
 * @param runs - Repeat count for this case (reproducibility).
 * @param call - Makes one call, returning the number to track and the raw result.
 * @returns The per-run numbers and the first run's raw result.
 */
async function runCase(
  runs: number,
  call: () => Promise<{ value: number; result: unknown }>,
): Promise<{ durations: number[]; first: unknown }> {
  const durations: number[] = [];
  let first: unknown = null;
  for (let i = 0; i < runs; i++) {
    const { value, result } = await call();
    durations.push(value);
    if (i === 0) first = result;
  }
  return { durations, first };
}

/**
 * Runs every case `runs` times and collects each numeric result, with a live progress line.
 * @param url - Server base URL.
 * @param adminSecret - Admin secret for both routes.
 * @param runs - Repeat count per case (reproducibility).
 * @param only - Case-id filters from --only; empty runs every case.
 * @returns Raw runs plus the live context used to build expectations.
 */
async function collectRaw(
  url: string,
  adminSecret: string,
  runs: number,
  only: string[],
): Promise<{ ctx: LiveContext; raw: RawRun[]; aborted: boolean }> {
  const { loadLiveContext } = await import("./context");
  const { callCaption, callEstimate, callParseJob, callMailingDraft, callPostDraft, fetchFacts } =
    await import("./client");
  const {
    PARSE_CASES,
    ESTIMATE_CASES,
    CROSS_ROUTE_CASES,
    TRAVEL_CASES,
    DRAFT_CASES,
    EMAIL_FROM_POST_CASES,
    POST_DRAFT_CASES,
    CAPTION_CASES,
    DEAL_RE,
  } = await import("./cases");

  process.stdout.write("Loading live context (settings, rates, templates)...\n");
  const ctx = await loadLiveContext();
  const raw: RawRun[] = [];

  /**
   * Whether --only keeps a case (substring match).
   * @param id - Case id (benchmarks are `est-<label>`).
   * @returns True when no filter is given or the id contains one of them.
   */
  const keep = (id: string): boolean => only.length === 0 || only.some((o) => id.includes(o));
  const benchmarks = ctx.benchmarks.filter((b) => keep(`est-${b.label}`));
  const estimateCases = ESTIMATE_CASES.filter((c) => keep(c.id));
  const parseCases = PARSE_CASES.filter((c) => keep(c.id));
  const travelCases = TRAVEL_CASES.filter((c) => keep(c.id));
  const crossRouteCases = CROSS_ROUTE_CASES.filter((c) => keep(c.id));
  const draftCases = [...DRAFT_CASES, ...EMAIL_FROM_POST_CASES].filter((c) => keep(c.id));
  const postDraftCases = POST_DRAFT_CASES.filter((c) => keep(c.id));
  const captionCases = CAPTION_CASES.filter((c) => keep(c.id));

  const total =
    benchmarks.length +
    estimateCases.length +
    parseCases.length +
    crossRouteCases.length +
    travelCases.length +
    draftCases.length +
    postDraftCases.length +
    captionCases.length;
  console.log(
    `Running ${total} cases x ${runs} run(s) = ${total * runs} paid calls. This takes a few minutes.\n`,
  );

  let done = 0;
  /**
   * Overwrites one status line (\r + clear-line) with the case about to run.
   * @param id - The case id currently being collected.
   */
  const tick = (id: string): void => {
    done++;
    process.stdout.write(`\r\x1b[2K  [${done}/${total}] ${id}`);
  };

  let consecutiveErrors = 0;
  let aborted = false;

  /**
   * Runs one case's collector, recording an error entry instead of throwing.
   * @param id - Case id.
   * @param kind - Case kind for the raw error entry.
   * @param fn - Collector that pushes the case's raw entry on success.
   */
  const tryCase = async (
    id: string,
    kind: RawRun["kind"],
    fn: () => Promise<void>,
  ): Promise<void> => {
    try {
      await fn();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const message = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      raw.push({ id, kind, durations: [], first: null, error: message });
      process.stdout.write(`\r\x1b[2K  \x1b[31m✗\x1b[0m ${id} errored - continuing\n`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) aborted = true;
    }
  };

  // Single-task estimate probes generated from live benchmarks.
  for (const b of benchmarks) {
    if (aborted) break;
    const id = `est-${b.label}`;
    tick(id);
    await tryCase(id, "estimate-single", async () => {
      const { durations, first } = await runCase(runs, async () => {
        const r = await callEstimate(
          url,
          adminSecret,
          `Just ${b.label.toLowerCase()}, nothing else`,
        );
        return { value: r.estimatedMins, result: r };
      });
      raw.push({ id, kind: "estimate-single", benchmarkLabel: b.label, durations, first });
    });
  }

  // Authored estimate cases (report-only drift + reproducibility).
  for (const c of estimateCases) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "estimate-multi", async () => {
      const { durations, first } = await runCase(runs, async () => {
        const r = await callEstimate(url, adminSecret, c.description);
        return { value: r.estimatedMins, result: r };
      });
      raw.push({ id: c.id, kind: "estimate-multi", durations, first });
    });
  }

  // Parse cases (canonical stated-time assertion, or report-only for "info").
  for (const c of parseCases) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "parse", async () => {
      const { durations, first } = await runCase(runs, async () => {
        const r = await callParseJob(url, adminSecret, c.input);
        return { value: r.durationMins ?? -1, result: r };
      });
      raw.push({
        id: c.id,
        kind: "parse",
        input: c.input,
        expectMode: c.expectMode ?? "exact",
        durations,
        first,
      });
    });
  }

  // Travel decisions run once each: the answer is a branch, not a measurement.
  for (const c of travelCases) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "travel", async () => {
      const r = await callParseJob(url, adminSecret, c.input);
      raw.push({
        id: c.id,
        kind: "travel",
        input: c.input,
        durations: [],
        first: r,
        travel: {
          gotDestination: r.destination ?? null,
          gotNoTravelCharge: r.noTravelCharge ?? null,
          wantDestination: c.destination,
          wantNoTravelCharge: c.noTravelCharge,
          gotStoreRuns: r.storeRuns ?? [],
          wantStoreRuns: c.storeRuns,
          why: c.why,
        },
      });
    });
  }

  // Fetched on the first draft case, before its paid call, so runs without one don't need it.
  let facts: string | undefined;

  // Mailing drafts run once each.
  for (const c of draftCases) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "draft", async () => {
      facts ??= await fetchFacts(url);
      const draft = await callMailingDraft(url, adminSecret, {
        brief: c.brief,
        kind: c.kind,
        buttonUrl: c.buttonUrl,
        source: c.source,
      });
      const { hard, soft } = draftProblems(draft, c.brief, facts);
      const text = JSON.stringify(draft);
      for (const f of c.forbid ?? []) if (f.pattern.test(text)) hard.push(f.why);
      if (c.wantBullets && draft.bullets.length === 0) hard.push("steps not listed as bullets");
      for (const fact of c.mustInclude ?? []) {
        if (!text.includes(fact)) hard.push(`dropped "${fact}" from the post`);
      }
      if (c.buttonLike && !c.buttonLike.test(draft.buttonText)) {
        hard.push(`button "${draft.buttonText}" doesn't match ${c.buttonLike}`);
      }
      raw.push({
        id: c.id,
        kind: "draft",
        input: c.brief,
        durations: [],
        first: draft,
        draftCheck: { hard, soft },
      });
    });
  }

  // Post maker drafts run once each; review cases check the quote is real or empty.
  for (const c of postDraftCases) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "draft", async () => {
      facts ??= await fetchFacts(url);
      const draft = await callPostDraft(url, adminSecret, {
        brief: c.brief,
        kind: c.kind,
        room: c.room,
        paidAd: c.paidAd,
      });
      if (!draft) {
        raw.push({
          id: c.id,
          kind: "draft",
          input: c.brief,
          durations: [],
          first: { headline: "(refused)" },
          draftCheck: {
            hard: c.refused ? [] : ["refused a brief it should have written"],
            soft: [],
          },
        });
        return;
      }
      const { hard, soft } = postDraftProblems(draft, c.brief, c.room, c.paidAd, facts);
      if (c.refused) hard.push("wrote a review post with no review words in the brief");
      if (c.quote === "filled" && !draft.quote) hard.push("no quote from real review words");
      if (c.quote === "empty" && (draft.quote || draft.name)) {
        hard.push("wrote a quote or name with no review words in the brief");
      }
      const text = JSON.stringify(draft);
      for (const f of c.forbid ?? []) if (f.pattern.test(text)) hard.push(f.why);
      raw.push({
        id: c.id,
        kind: "draft",
        input: c.brief,
        durations: [],
        first: draft,
        draftCheck: { hard, soft },
      });
    });
  }

  // Write with AI runs once per case, checked against the live brand profile and promo.
  const brand = {
    tags: parseHashtags(ctx.brand.hashtags).tags,
    avoid: avoidList(ctx.brand.avoid),
  };
  for (const c of captionCases) {
    if (aborted) break;
    tick(c.id);
    if (c.avoidBait && brand.avoid.length === 0) {
      raw.push({
        id: c.id,
        kind: "draft",
        input: c.request.brief,
        durations: [],
        first: null,
        skip: "the brand profile has no Never mention words to test",
      });
      continue;
    }
    await tryCase(c.id, "draft", async () => {
      facts ??= await fetchFacts(url);
      const body = {
        mode: "write",
        kind: "general",
        length: "medium",
        hashtags: false,
        emoji: false,
        ending: "none",
        platforms: ["facebook", "instagram"],
        count: 2,
        promoId: null,
        ...c.request,
        brief: c.avoidBait ? `${c.request.brief} Mention ${brand.avoid[0]} too.` : c.request.brief,
      };
      const req = parseCaptionRequest(body);
      if ("error" in req) throw new Error(`bad case request: ${req.error}`);
      const captions = await callCaption(url, adminSecret, body);
      const { hard, soft } = captionProblems(captions, req, facts, brand);
      const all = captions.join("\n---\n");
      for (const k of c.keep ?? [])
        if (!captions.every((t) => t.includes(k))) hard.push(`lost "${k}"`);
      for (const f of c.forbid ?? []) if (f.pattern.test(all)) hard.push(f.why);
      if (c.promoCheck && ctx.promoRunning && !captions.every((t) => t.includes("{promoOffer}"))) {
        hard.push("a promo is running but {promoOffer} isn't used");
      }
      if (c.promoCheck && !ctx.promoRunning && DEAL_RE.test(all)) {
        hard.push("no promo is running but it mentions a deal");
      }
      if (c.wantRate) {
        const rate = facts.match(/Standard rate: NZ\$([\d.]+) per hour/)?.[1];
        if (!rate) hard.push("BUSINESS FACTS has no standard rate");
        else if (!captions.every((t) => t.includes(`$${rate}`))) {
          hard.push(`doesn't quote the standard rate ($${rate})`);
        }
      }
      raw.push({
        id: c.id,
        kind: "draft",
        input: body.brief,
        durations: [],
        first: { captions },
        draftCheck: { hard, soft },
      });
    });
  }

  // Cross-route: same job to BOTH routes once, to compare estimate vs stated-time duration.
  for (const c of crossRouteCases) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "cross-route", async () => {
      const est = await callEstimate(url, adminSecret, c.input);
      const job = await callParseJob(url, adminSecret, c.input);
      raw.push({
        id: c.id,
        kind: "cross-route",
        input: c.input,
        durations: [est.estimatedMins],
        parseMins: job.durationMins ?? -1,
        first: est,
      });
    });
  }

  process.stdout.write("\r\x1b[2K"); // clear the progress line before the report
  return { ctx, raw, aborted };
}

/**
 * Turns raw runs into checks: context (hard), reproducibility (soft) and drift (info).
 * @param ctx - Live context used to build expectations.
 * @param raw - Collected raw runs.
 * @returns Ordered check results.
 */
function evaluate(ctx: LiveContext, raw: RawRun[]): CheckResult[] {
  const out: CheckResult[] = [];
  const inc = ctx.incrementMins;

  for (const r of raw) {
    if (r.skip) {
      out.push({
        id: r.id,
        family: "draft",
        label: `draft ${r.id}`,
        status: "skip",
        detail: r.skip,
      });
      continue;
    }
    // Errored case: hard fail, then skip the family checks.
    if (r.error) {
      out.push({
        id: r.id,
        family: "context",
        label: `${r.kind} ${r.id}`,
        status: "fail",
        detail: `case errored: ${r.error}`,
      });
      continue;
    }
    const first = r.durations[0];

    // Family 1: single-task estimate must reflect the live benchmark.
    if (r.kind === "estimate-single") {
      const bench = ctx.benchmarks.find((b) => b.label === r.benchmarkLabel);
      if (bench) {
        const expected = expectedEstimateMins(bench.mins, ctx.minBillableMins, inc, ctx.maxJobMins);
        const tol = estimateTolerance(expected, inc);
        const ok = withinTolerance(first, expected, tol);
        out.push({
          id: r.id,
          family: "context",
          label: `estimate "${r.benchmarkLabel}"`,
          status: ok ? "pass" : "fail",
          detail: `got ${first}, expected ${expected} +/-${tol}`,
        });
      }
    }

    // Family 3 report-only: authored estimate printed for eyeballing.
    if (r.kind === "estimate-multi") {
      out.push({
        id: r.id,
        family: "drift",
        label: `estimate ${r.id}`,
        status: "info",
        detail: `estimatedMins=${first} (review vs your benchmarks)`,
      });
    }

    // Family 1: parse-job must use the canonical stated times exactly ("exact"),
    // or just report what came back ("info" - no pre-compute / model-estimated).
    if (r.kind === "parse") {
      const canonical = calcSessionMins(r.input ?? "");
      if (r.expectMode === "info") {
        out.push({
          id: r.id,
          family: "context",
          label: `parse ${r.id} (info)`,
          status: "info",
          detail:
            canonical === null
              ? `durationMins=${first} (no pre-compute; model-estimated)`
              : `durationMins=${first} (canonical ${canonical})`,
        });
      } else {
        // The route caps durationMins at the day ceiling, and an absent value is stored as -1.
        // No minimum or increment applies: durationMins is worked minutes.
        const expected = canonical === null ? -1 : Math.min(canonical, ctx.maxJobMins);
        /**
         * Renders a measured duration, spelling out the -1 "absent" sentinel.
         * @param v - Minutes, or -1 when the route reported no duration.
         * @returns Human-readable value for the check detail.
         */
        const show = (v: number): string => (v === -1 ? "no duration" : String(v));
        out.push({
          id: r.id,
          family: "context",
          label: `parse durationMins ${r.id}`,
          status: first === expected ? "pass" : "fail",
          detail: `got ${show(first)}, expected exactly ${show(expected)}${
            canonical !== null && expected !== canonical
              ? ` (canonical ${canonical}, capped at the ${ctx.maxJobMins} min ceiling)`
              : ""
          }`,
        });
      }
    }

    // Travel: destination and noTravelCharge are asserted together.
    if (r.kind === "travel" && r.travel) {
      const t = r.travel;
      const dest = t.gotDestination;
      const destOk =
        t.wantDestination === null
          ? dest === null
          : typeof dest === "string" && dest.toLowerCase().includes(t.wantDestination);
      const chargeOk = t.gotNoTravelCharge === t.wantNoTravelCharge;
      // Store runs, when pinned: the same count, each wanted store matched by substring.
      const want = t.wantStoreRuns;
      const got = t.gotStoreRuns ?? [];
      const storesOk =
        !want ||
        (got.length === want.length &&
          want.every((w) => got.some((g) => g.toLowerCase().includes(w))));
      const storesDetail = want
        ? `, storeRuns ${JSON.stringify(got)} (want ${want.length ? want.map((w) => `"${w}"`).join(", ") : "none"})`
        : "";
      // Naming a destination then refusing to charge it is always wrong.
      const contradiction = dest !== null && t.gotNoTravelCharge === true;
      const wantDest = t.wantDestination === null ? "null" : `containing "${t.wantDestination}"`;
      out.push({
        id: r.id,
        family: "travel",
        label: `travel ${r.id}`,
        status: destOk && chargeOk && storesOk && !contradiction ? "pass" : "fail",
        detail: contradiction
          ? `contradiction: named ${JSON.stringify(dest)} then set noTravelCharge true`
          : `destination ${JSON.stringify(dest)} (want ${wantDest}), noTravelCharge ${t.gotNoTravelCharge} (want ${t.wantNoTravelCharge})${storesDetail} - ${t.why}`,
      });
    }

    // Cross-route (report-only): estimate vs stated-time duration, plus the canonical total.
    if (r.kind === "cross-route") {
      const canonical = calcSessionMins(r.input ?? "");
      const stated =
        canonical === null
          ? null
          : clampBillableMins(canonical, ctx.minBillableMins, inc, ctx.maxJobMins);
      const estMins = r.durations[0];
      const parseMins = r.parseMins ?? -1;
      out.push({
        id: r.id,
        family: "cross-route",
        label: `cross-route ${r.id}`,
        status: "info",
        detail: `estimate=${estMins} vs parse=${parseMins} (stated ${stated}) delta=${estMins - parseMins}`,
      });
    }

    // Draft: the shared rules plus the case's forbid list are hard; style is info.
    if (r.kind === "draft" && r.draftCheck) {
      const { hard, soft } = r.draftCheck;
      const draft = r.first as {
        subject?: string;
        headline?: string;
        quote?: string;
        captions?: string[];
      };
      // A caption shows its first line, which is all that fits on one report line.
      const shown =
        draft.subject ??
        (draft.headline || draft.quote || draft.captions?.[0]?.split("\n")[0]?.slice(0, 80));
      out.push({
        id: r.id,
        family: "draft",
        label: `draft ${r.id}`,
        status: hard.length === 0 ? "pass" : "fail",
        detail:
          (hard.length === 0 ? `"${shown ?? ""}"` : hard.join("; ")) +
          (soft.length > 0 ? ` (style: ${soft.join(", ")})` : ""),
      });
    }

    // Family 2: reproducibility. Exact-parse cases need zero spread; model estimates get
    // an increment-based tolerance.
    if (r.kind !== "cross-route" && r.kind !== "draft") {
      const sp = spread(r.durations);
      const tol = r.kind === "parse" && r.expectMode !== "info" ? 0 : 2 * inc;
      out.push({
        id: r.id,
        family: "reproducibility",
        label: `reproducibility ${r.id}`,
        status: sp <= tol ? "pass" : "fail",
        detail: `spread ${sp} over [${r.durations.join(", ")}], tol ${tol}`,
      });
    }
  }
  return out;
}

/**
 * Prints checks grouped by family with a pass/fail/skip/info icon.
 * @param checks - Evaluated checks.
 */
function printReport(checks: CheckResult[]): void {
  const families: CheckResult["family"][] = [
    "context",
    "travel",
    "draft",
    "reproducibility",
    "drift",
    "cross-route",
  ];
  const titles: Record<CheckResult["family"], string> = {
    context: "1. Each model uses ALL context",
    travel: "2. Travel decisions (one round trip, or none)",
    draft:
      "2b. Mailing and post maker drafts (no dashes, no made-up figures, claims or reviews, no greeting or sign-off)",
    reproducibility: "3. Reproducibility",
    drift: "4. Public estimate vs benchmarks (report-only)",
    "cross-route":
      "5. Cross-route drift (report-only): public estimate vs admin stated-time duration",
  };
  for (const fam of families) {
    const rows = checks.filter((c) => c.family === fam);
    if (rows.length === 0) continue;
    console.log(`\n${titles[fam]}`);
    for (const c of rows) {
      const icon =
        c.status === "pass"
          ? "\x1b[32m✓\x1b[0m"
          : c.status === "fail"
            ? "\x1b[31m✗\x1b[0m"
            : c.status === "skip"
              ? "\x1b[33m-\x1b[0m"
              : "\x1b[36m•\x1b[0m";
      console.log(`  ${icon} ${c.label} - ${c.detail}`);
    }
  }
}

(async () => {
  const { selfTest, probe, url, showContext, runs, only } = parseArgs();
  if (selfTest) {
    process.exit(runSelfTest());
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("ADMIN_SECRET not set in .env.local - required for the harness.");
    process.exit(1);
  }
  try {
    if (probe) {
      const { callEstimate, callParseJob } = await import("./client");
      const est = await callEstimate(url, adminSecret, "Set up a new printer");
      console.log("estimate:", est.estimatedMins, "min,", est.tasks.length, "task(s)");
      const job = await callParseJob(url, adminSecret, "Set up a new laptop, 9-11am");
      console.log("parse:", job.durationMins, "min,", job.tasks?.length ?? 0, "task(s)");
      process.exit(0);
    }
    if (showContext) {
      const { loadLiveContext } = await import("./context");
      const ctx = await loadLiveContext();
      console.log(
        `benchmarks: ${ctx.benchmarks.length}, rates: ${ctx.rates.length}, templates: ${ctx.templates.length}`,
      );
      console.log(
        `minBillable: ${ctx.minBillableMins}m, increment: ${ctx.incrementMins}m, maxJob: ${ctx.maxJobMins}m`,
      );
      for (const b of ctx.benchmarks) console.log(`  - ${b.label}: ${b.mins}m`);
      process.exit(0);
    }
    const started = new Date().toISOString();
    const { ctx, raw, aborted } = await collectRaw(url, adminSecret, runs, only);
    const checks = evaluate(ctx, raw);
    printReport(checks);

    const fs = await import("fs");
    const path = await import("path");
    const dir = path.join("docs", "eval-ai");
    fs.mkdirSync(dir, { recursive: true });
    const artifact = path.join(dir, `run-${started.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(artifact, JSON.stringify({ started, runs, checks, raw }, null, 2));

    // Context, travel and draft INVARIANTs have one right answer, so they gate the exit code.
    // Reproducibility only warns: a hosted LLM is never bit-for-bit reproducible.
    const hardFailed = checks.filter(
      (c) =>
        c.status === "fail" &&
        (c.family === "context" || c.family === "travel" || c.family === "draft"),
    );
    const reproFailed = checks.filter((c) => c.status === "fail" && c.family === "reproducibility");
    const completed = raw.filter((r) => !r.error);
    const calls = completed.length * runs;
    console.log(
      `\n${completed.length}/${raw.length} cases completed, ~${calls} paid calls. Artifact: ${artifact}`,
    );
    if (aborted) {
      // Name what actually failed rather than guessing at the cause.
      const errors = raw.map((r) => r.error ?? "").filter(Boolean);
      /**
       * Whether any recorded case error mentions a given marker.
       * @param needle - Substring identifying one failure mode.
       * @returns True when at least one errored case reported it.
       */
      const has = (needle: string): boolean => errors.some((e) => e.includes(needle));
      const cause = has("Could not reach the dev server")
        ? "the dev server stopped answering - check it is still up (a corrupted .next needs `rm -rf .next` and a restart)"
        : has("HTTP 404")
          ? "the route was not found - port 3000 may be serving a different project"
          : has("HTTP 401")
            ? "the admin secret was rejected - ADMIN_SECRET must match the running server"
            : has("HTTP 500")
              ? "the route threw - the real stack trace is in the dev server terminal"
              : has("HTTP 429")
                ? "the OpenAI rate limit outlasted every backoff retry - check tokens-per-minute on the account"
                : "see the per-case errors above";
      console.log(
        `
[33m⚠ run aborted early after ${MAX_CONSECUTIVE_ERRORS} consecutive case errors (${errors.length} errored total) - ${cause}. Completed cases are reported above and saved in the artifact.[0m`,
      );
    }
    if (reproFailed.length > 0) {
      console.log(
        `\n\x1b[33m⚠ ${reproFailed.length} reproducibility warning(s) - same input varied across runs (model non-determinism, not a gate).\x1b[0m`,
      );
    }
    console.log(
      hardFailed.length === 0
        ? `\n\x1b[32m✓ all hard (context, travel, draft) assertions passed\x1b[0m\n`
        : `\n\x1b[31m✗ ${hardFailed.length} hard (context, travel, draft) assertion(s) failed\x1b[0m\n`,
    );
    process.exit(hardFailed.length === 0 ? 0 : 1);
  } catch (err) {
    // Print the diagnostic as one line and exit non-zero; catching also avoids a libuv
    // assertion on Windows from an unhandled rejection.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n\x1b[31m✗ eval run failed\x1b[0m\n  ${message}\n`);
    process.exit(1);
  }
})();
