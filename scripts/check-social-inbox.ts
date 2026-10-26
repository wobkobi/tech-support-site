// scripts/check-social-inbox.ts
// Social inbox: reading Facebook comments, Instagram comments, Google reviews and Messenger and
// Instagram conversations into rows, spotting our own replies, which threads need a reply, the
// 24-hour message window, read and archive marks after a sync, the sync's stored record, the
// inbox's address, names, snippets, times, reply checks, suggestion requests and the review post
// brief. Pure logic, no DB.
// Run with: npm test -- social-inbox

import {
  attachmentLabel,
  authorLabel,
  conversationRows,
  countKey,
  DM_WINDOW_MS,
  facebookRows,
  firstName,
  googleRows,
  inboxHref,
  instagramRows,
  isDirect,
  isWindowError,
  listWhen,
  marksAfterSync,
  messageWhen,
  objectsToRead,
  parseReplyRequest,
  pruneCounts,
  readCommentsState,
  readInboxQuery,
  readReplySuggestion,
  replyLength,
  replyOpenUntil,
  replyProblem,
  reviewBrief,
  snippet,
  threadState,
  windowClosedText,
  type ThreadMessage,
} from "@/features/social/lib/inbox/map";
import { expect, expectEqual, finish } from "./lib/harness.js";

const NOW = new Date("2026-10-22T03:00:00.000Z");
const MIN = 60_000;

/**
 * A time some minutes before now.
 * @param minutes - Minutes back.
 * @returns The time.
 */
function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MIN);
}

/**
 * A thread message.
 * @param fromUs - Whether it's ours.
 * @param minutesAgo - When it was written.
 * @param over - Anything else.
 * @returns The message.
 */
function msg(
  fromUs: boolean,
  minutesAgo: number,
  over: Partial<ThreadMessage> = {},
): ThreadMessage {
  return { fromUs, at: ago(minutesAgo), hidden: null, gone: false, ...over };
}

console.log("Facebook comments");
{
  const rows = facebookRows(
    [
      {
        id: "c1",
        message: " Do you fix Macs? ",
        created_time: "2026-10-21T01:00:00+0000",
        from: { id: "u1", name: "Mary Smith" },
      },
      {
        id: "c2",
        message: "Yes I do.",
        created_time: "2026-10-21T02:00:00+0000",
        from: { id: "page1", name: "To The Point Tech" },
        parent: { id: "c1" },
      },
      {
        id: "c3",
        message: "Thanks!",
        created_time: "2026-10-21T03:00:00+0000",
        from: { id: "u1", name: "Mary Smith" },
        parent: { id: "c2" },
        is_hidden: false,
      },
      { id: "c4", message: "no from", created_time: "2026-10-21T04:00:00+0000" },
      { message: "no id", created_time: "2026-10-21T04:00:00+0000" },
    ],
    "page1_post1",
    "page1",
  );
  expectEqual("rows kept", rows.length, 4);
  expectEqual("top-level comment", [rows[0]!.kind, rows[0]!.threadExternalId], ["comment", null]);
  expectEqual("text trimmed", rows[0]!.text, "Do you fix Macs?");
  expectEqual(
    "reply threads under its comment",
    [rows[1]!.kind, rows[1]!.threadExternalId],
    ["reply", "c1"],
  );
  expect("our Page's reply is ours", rows[1]!.fromUs);
  expectEqual("a reply to a reply threads under the top comment", rows[2]!.threadExternalId, "c1");
  expect("their reply isn't ours", !rows[2]!.fromUs);
  expectEqual("no writer named", [rows[3]!.authorName, rows[3]!.fromUs], [null, false]);
  expectEqual("object kept", rows[0]!.objectExternalId, "page1_post1");
  expect(
    "nothing is ours without a Page id",
    facebookRows(
      [{ id: "x", created_time: "2026-10-21T01:00:00+0000", from: { id: "page1" } }],
      "p",
      null,
    )[0]!.fromUs === false,
  );
}

console.log("Instagram comments");
{
  const rows = instagramRows(
    {
      id: "ig1",
      text: "Love this",
      timestamp: "2026-10-21T01:00:00+0000",
      username: "kiwi_nan",
      from: { id: "u9", username: "kiwi_nan" },
      hidden: false,
      replies: {
        data: [
          {
            id: "ig2",
            text: "Thank you!",
            timestamp: "2026-10-21T02:00:00+0000",
            username: "tothepointtech",
          },
          { id: "ig3", text: "no time" },
        ],
      },
    },
    "media1",
    { id: "us1", username: "ToThePointTech" },
  );
  expectEqual("comment and timed reply", rows.length, 2);
  expectEqual(
    "comment",
    [rows[0]!.kind, rows[0]!.authorName, rows[0]!.fromUs],
    ["comment", "kiwi_nan", false],
  );
  expectEqual(
    "reply by username is ours",
    [rows[1]!.kind, rows[1]!.threadExternalId, rows[1]!.fromUs],
    ["reply", "ig1", true],
  );
  const byId = instagramRows(
    { id: "a", timestamp: "2026-10-21T01:00:00+0000", from: { id: "us1" } },
    "m",
    { id: "us1", username: null },
  );
  expect("ours by account id", byId[0]!.fromUs);
  expectEqual(
    "a comment with no id is dropped",
    instagramRows({ text: "x" }, "m", { id: null, username: null }),
    [],
  );
}

console.log("Google reviews");
{
  const [review, reply] = googleRows({
    name: "accounts/1/locations/2/reviews/r1",
    reviewer: { displayName: "John Brown" },
    starRating: "FOUR",
    comment: "Fixed my printer fast.",
    createTime: "2026-10-01T00:00:00Z",
    updateTime: "2026-10-01T00:00:00Z",
    reviewReply: { comment: "Thanks John!", updateTime: "2026-10-02T00:00:00Z" },
  });
  if (!review || !reply) throw new Error("A replied review should give two rows.");
  expectEqual("stars as a number", review.rating, 4);
  expectEqual(
    "review row",
    [review.kind, review.threadExternalId, review.fromUs],
    ["review", null, false],
  );
  expectEqual(
    "our reply is a reply row",
    [reply.externalId, reply.threadExternalId, reply.fromUs],
    ["accounts/1/locations/2/reviews/r1/reply", "accounts/1/locations/2/reviews/r1", true],
  );
  expectEqual(
    "reply dated by Google's stamp",
    reply.postedAt.toISOString(),
    "2026-10-02T00:00:00.000Z",
  );
  expectEqual("not edited", review.editedAt, null);

  const anon = googleRows({
    name: "accounts/1/locations/2/reviews/r2",
    reviewer: { displayName: "Someone", isAnonymous: true },
    starRating: "ONE",
    createTime: "2026-10-01T00:00:00Z",
    updateTime: "2026-10-05T00:00:00Z",
  });
  expectEqual("anonymous writer has no name", anon[0]!.authorName, null);
  expectEqual("stars only, no words", anon[0]!.text, "");
  expectEqual(
    "changed later is an edit",
    anon[0]!.editedAt?.toISOString(),
    "2026-10-05T00:00:00.000Z",
  );
  expectEqual("no reply, no reply row", anon.length, 1);

  const bumped = googleRows({
    name: "accounts/1/locations/2/reviews/r3",
    starRating: "FIVE",
    createTime: "2026-10-01T00:00:00Z",
    updateTime: "2026-10-03T00:01:00Z",
    reviewReply: { comment: "Thanks", updateTime: "2026-10-03T00:00:00Z" },
  });
  expectEqual("a change with our reply isn't an edit", bumped[0]!.editedAt, null);
  expectEqual(
    "unknown stars",
    googleRows({
      name: "n",
      createTime: "2026-10-01T00:00:00Z",
      starRating: "STAR_RATING_UNSPECIFIED",
    })[0]!.rating,
    null,
  );
  expectEqual(
    "a blank reply is no reply",
    googleRows({ name: "n", createTime: "2026-10-01T00:00:00Z", reviewReply: { comment: "  " } })
      .length,
    1,
  );
}

console.log("Messenger and Instagram conversations");
{
  const page = "883";
  const rows = conversationRows(
    "facebook",
    {
      id: "t_1",
      updated_time: ago(5).toISOString(),
      link: "/883/inbox/1/?section=messages",
      participants: {
        data: [
          { id: "psid9", name: " Mary Smith " },
          { id: page, name: "To The Point Tech" },
        ],
      },
      // Newest first, as Messenger gives them.
      messages: {
        data: [
          {
            id: "m_3",
            created_time: ago(5).toISOString(),
            from: { id: page, name: "To The Point Tech" },
            message: "Sure, see you then",
          },
          {
            id: "m_2",
            created_time: ago(30).toISOString(),
            from: { id: "psid9", name: "Mary Smith" },
            message: "",
            attachments: { data: [{ mime_type: "image/jpeg" }, { mime_type: "image/png" }] },
          },
          {
            id: "m_1",
            created_time: ago(60).toISOString(),
            from: { id: "psid9", name: "Mary Smith" },
            message: " Can you look at my laptop? ",
          },
          { id: "m_bad" },
        ],
      },
    },
    page,
  );
  expectEqual(
    "conversation first, then messages oldest first",
    rows.map((r) => [r.kind, r.externalId, r.threadExternalId]),
    [
      ["conversation", "t_1", null],
      ["message", "m_1", "t_1"],
      ["message", "m_2", "t_1"],
      ["message", "m_3", "t_1"],
    ],
  );
  const top = rows[0]!;
  expectEqual(
    "the person, with their id to reply to",
    [top.authorName, top.authorId],
    ["Mary Smith", "psid9"],
  );
  expectEqual("latest words, marked when ours", top.text, "You: Sure, see you then");
  expectEqual("starts at the oldest message", top.postedAt.getTime(), ago(60).getTime());
  expectEqual(
    "ours spotted by the Page id",
    rows.map((r) => r.fromUs),
    [false, false, false, true],
  );
  expectEqual("pictures with no words", rows[2]?.text, "(Sent 2 pictures)");
  expectEqual("words trimmed", rows[1]?.text, "Can you look at my laptop?");

  const ig = conversationRows(
    "instagram",
    {
      id: "aWdf",
      participants: {
        data: [
          { id: "1784", username: "tothepointtech" },
          { id: "igsid5", username: "kiwi_nan" },
        ],
      },
      messages: {
        data: [
          {
            id: "ig_1",
            created_time: ago(10).toISOString(),
            from: { id: "igsid5", username: "kiwi_nan" },
            message: "Hi, do you come to Ponsonby?",
          },
        ],
      },
    },
    "1784",
  );
  expectEqual(
    "Instagram username kept",
    [ig[0]?.authorName, ig[0]?.authorId],
    ["kiwi_nan", "igsid5"],
  );
  expectEqual("their latest words as written", ig[0]?.text, "Hi, do you come to Ponsonby?");
  expectEqual("no messages, no thread", conversationRows("facebook", { id: "t_2" }, page), []);
  expectEqual("no id, no thread", conversationRows("facebook", {}, page), []);

  expectEqual(
    "one video",
    attachmentLabel({ attachments: { data: [{ mime_type: "video/mp4" }] } }),
    "(Sent a video)",
  );
  expectEqual(
    "voice",
    attachmentLabel({ attachments: { data: [{ mime_type: "audio/mpeg" }] } }),
    "(Sent a voice message)",
  );
  expectEqual("file", attachmentLabel({ attachments: { data: [{}] } }), "(Sent a file)");
  expectEqual("sticker", attachmentLabel({ sticker: "https://x" }), "(Sent a sticker)");
  expectEqual("story reply", attachmentLabel({ story: { id: "s" } }), "(Replied to your story)");
  expectEqual("share", attachmentLabel({ shares: { data: [{}] } }), "(Shared a post)");
  expectEqual("anything else", attachmentLabel({}), "(Sent something the app can't show here)");

  expect("conversations are direct", isDirect("conversation") && isDirect("message"));
  expect("comments aren't", !isDirect("comment") && !isDirect("reply") && !isDirect("review"));
}

console.log("The message window");
{
  const until = replyOpenUntil([
    { fromUs: false, postedAt: ago(120).toISOString() },
    { fromUs: false, postedAt: ago(60) },
    { fromUs: true, postedAt: ago(5) },
  ]);
  expectEqual("a day after their latest", until?.getTime(), ago(60).getTime() + DM_WINDOW_MS);
  expectEqual(
    "only ours: can't answer",
    replyOpenUntil([{ fromUs: true, postedAt: ago(5) }]),
    null,
  );
  expectEqual(
    "an unsent one doesn't count",
    replyOpenUntil([
      { fromUs: false, postedAt: ago(120) },
      { fromUs: false, postedAt: ago(10), gone: true },
    ])?.getTime(),
    ago(120).getTime() + DM_WINDOW_MS,
  );
  expect(
    "Meta's window refusal",
    isWindowError("(#10) This message is sent outside of allowed window."),
  );
  expect(
    "a missing permission isn't",
    !isWindowError("(#10) Requires pages_messaging permission") && !isWindowError(null),
  );
  expect(
    "closed after their message",
    windowClosedText("instagram", true).startsWith("It's been more than a day since their last"),
  );
  expect(
    "closed when only we wrote",
    windowClosedText("facebook", false).startsWith("They haven't sent you a message") &&
      windowClosedText("facebook", false).includes("Messenger itself"),
  );
}

console.log("Needs a reply");
{
  expect("their comment alone needs a reply", threadState([msg(false, 60)]).needsReply);
  expect("answered", !threadState([msg(false, 60), msg(true, 30)]).needsReply);
  expect(
    "they wrote again",
    threadState([msg(false, 60), msg(true, 30), msg(false, 10)]).needsReply,
  );
  expect(
    "a moment after our reply is the same exchange",
    !threadState([msg(false, 60), msg(true, 30), msg(false, 27)]).needsReply,
  );
  expect(
    "hidden comments don't ask for a reply",
    !threadState([msg(false, 60, { hidden: true })]).needsReply,
  );
  expect("deleted ones don't either", !threadState([msg(false, 60, { gone: true })]).needsReply);
  expect("our own post comment needs nothing", !threadState([msg(true, 60)]).needsReply);
  const state = threadState([msg(false, 60), msg(true, 30), msg(false, 50, { hidden: true })]);
  expectEqual(
    "last activity is the newest",
    state.lastActivityAt.toISOString(),
    ago(30).toISOString(),
  );
  expectEqual("our latest reply", state.repliedAt?.toISOString(), ago(30).toISOString());
  expectEqual("their latest showing", state.theirsAt?.toISOString(), ago(60).toISOString());
  expectEqual(
    "all gone still dates the thread",
    threadState([msg(false, 90, { gone: true })]).lastActivityAt.toISOString(),
    ago(90).toISOString(),
  );
}

console.log("Read and archive marks");
{
  const run = { now: NOW, firstRun: false };
  expectEqual("a new thread is unread", marksAfterSync(null, threadState([msg(false, 5)]), run), {
    readAt: null,
    archivedAt: null,
  });
  expectEqual(
    "a thread that's only ours comes in read",
    marksAfterSync(null, threadState([msg(true, 5)]), run).readAt?.toISOString(),
    NOW.toISOString(),
  );
  expectEqual(
    "an old thread on the first run comes in read",
    marksAfterSync(null, threadState([msg(false, 20 * 24 * 60)]), {
      now: NOW,
      firstRun: true,
    }).readAt?.toISOString(),
    NOW.toISOString(),
  );
  expectEqual(
    "a recent one on the first run is unread",
    marksAfterSync(null, threadState([msg(false, 60)]), { now: NOW, firstRun: true }).readAt,
    null,
  );
  const read = { lastActivityAt: ago(60), readAt: ago(30), archivedAt: ago(20) };
  expectEqual(
    "nothing new keeps the marks",
    marksAfterSync(read, threadState([msg(false, 60)]), run),
    { readAt: ago(30), archivedAt: ago(20) },
  );
  expectEqual(
    "their new reply brings it back",
    marksAfterSync(read, threadState([msg(false, 60), msg(false, 10)]), run),
    { readAt: null, archivedAt: null },
  );
  expectEqual(
    "our new reply doesn't",
    marksAfterSync(read, threadState([msg(false, 60), msg(true, 10)]), run).readAt?.toISOString(),
    ago(30).toISOString(),
  );
  expectEqual(
    "a stamp just after our reply doesn't",
    marksAfterSync(
      { lastActivityAt: ago(30), readAt: ago(29), archivedAt: null },
      threadState([msg(true, 30), msg(false, 28)]),
      run,
    ).readAt?.toISOString(),
    ago(29).toISOString(),
  );
}

console.log("The sync's record");
{
  expectEqual("nothing stored", readCommentsState(null), {
    ranAt: null,
    counts: {},
    googleTotal: null,
    googleSeen: null,
    errors: {},
    messagesSeen: {},
    messageErrors: {},
  });
  expectEqual("broken JSON", readCommentsState("{oops").counts, {});
  expectEqual(
    "keeps what's well formed",
    readCommentsState(
      JSON.stringify({
        ranAt: "2026-10-22T00:00:00.000Z",
        counts: { "facebook:p1": 3, "facebook:p2": -1, "instagram:m1": 1.5, "instagram:m2": 0 },
        googleTotal: 12,
        googleSeen: "2026-10-21T00:00:00Z",
        errors: { facebook: "Needs pages_read_user_content", tiktok: "no" },
        messagesSeen: { facebook: "2026-10-22T01:00:00.000Z", instagram: "soon", google: "x" },
        messageErrors: { instagram: "Needs instagram_manage_messages", google: "no" },
      }),
    ),
    {
      ranAt: "2026-10-22T00:00:00.000Z",
      counts: { "facebook:p1": 3, "instagram:m2": 0 },
      googleTotal: 12,
      googleSeen: "2026-10-21T00:00:00Z",
      errors: { facebook: "Needs pages_read_user_content" },
      messagesSeen: { facebook: "2026-10-22T01:00:00.000Z" },
      messageErrors: { instagram: "Needs instagram_manage_messages" },
    },
  );
  const counts = { [countKey("facebook", "p1")]: 2, [countKey("facebook", "p2")]: 1 };
  expectEqual(
    "reads moved and new posts with comments",
    objectsToRead(
      "facebook",
      [
        { id: "p1", count: 3 },
        { id: "p2", count: 1 },
        { id: "p3", count: 0 },
        { id: "p4", count: 2 },
      ],
      counts,
    ),
    ["p1", "p4"],
  );
  expectEqual("a drop is read too", objectsToRead("facebook", [{ id: "p1", count: 1 }], counts), [
    "p1",
  ]);
  expectEqual(
    "prunes one app's old posts only",
    pruneCounts({ "facebook:p1": 1, "facebook:old": 2, "instagram:m1": 3 }, "facebook", ["p1"]),
    { "facebook:p1": 1, "instagram:m1": 3 },
  );
}

console.log("The inbox's address");
{
  expectEqual("defaults", readInboxQuery({}), {
    tab: "inbox",
    filter: "all",
    app: "all",
    show: "all",
    q: "",
  });
  expectEqual(
    "reads each part",
    readInboxQuery({
      tab: "archive",
      filter: "needs-reply",
      app: "google",
      show: "comments",
      q: "  printer ",
    }),
    { tab: "archive", filter: "needs-reply", app: "google", show: "comments", q: "printer" },
  );
  expectEqual(
    "unknown parts fall back",
    readInboxQuery({ tab: "x", filter: "y", app: "tiktok", show: "dms" }),
    { tab: "inbox", filter: "all", app: "all", show: "all", q: "" },
  );
  expectEqual("default href", inboxHref(readInboxQuery({})), "/admin/social/inbox");
  expectEqual(
    "href with parts and a thread",
    inboxHref(
      { tab: "archive", filter: "hidden", app: "facebook", show: "messages", q: "mac book" },
      "abc",
    ),
    "/admin/social/inbox?tab=archive&filter=hidden&app=facebook&show=messages&q=mac+book&open=abc",
  );
}

console.log("Names and snippets");
{
  expectEqual("first name", firstName("facebook", "Mary Smith"), "Mary");
  expectEqual("Google name", firstName("google", "John"), "John");
  expectEqual("Instagram usernames aren't names", firstName("instagram", "Mary"), null);
  expectEqual("lower-case handle isn't a name", firstName("facebook", "techguy99"), null);
  expectEqual("initial isn't a name", firstName("google", "J. Brown"), null);
  expectEqual("no name", firstName("facebook", null), null);
  expectEqual("macron name", firstName("google", "Mere Tūhoe"), "Mere");
  expectEqual("ours", authorLabel("facebook", "To The Point Tech", true), "You");
  expectEqual("Instagram handle", authorLabel("instagram", "kiwi_nan", false), "@kiwi_nan");
  expectEqual("anonymous Google", authorLabel("google", null, false), "A Google user");
  expectEqual("unnamed Facebook", authorLabel("facebook", null, false), "Someone");
  expectEqual("short snippet", snippet("  Hi\nthere  "), "Hi there");
  expectEqual("long snippet", snippet("abcdefghij", 6), "abcde...");
}

console.log("Replies");
{
  expectEqual("empty", replyProblem("facebook", "  "), "Write a reply first.");
  expectEqual("fine", replyProblem("google", "Thanks John!"), null);
  expectEqual(
    "too long for Instagram",
    replyProblem("instagram", "a".repeat(2201)),
    "Keep it to 2,200 characters.",
  );
  expectEqual(
    "suggestion cleaned",
    readReplySuggestion(
      { reply: "Thanks Mary — glad it’s sorted! #tech #NZ", hide: false },
      "facebook",
    ),
    { reply: "Thanks Mary - glad it's sorted!", hide: false },
  );
  expectEqual("spam", readReplySuggestion({ reply: "", hide: true }, "instagram"), {
    reply: "",
    hide: true,
  });
  expectEqual("junk answer", readReplySuggestion("nope", "google"), { reply: "", hide: false });
  expectEqual(
    "capped",
    readReplySuggestion({ reply: "a".repeat(3000) }, "instagram").reply.length,
    2200,
  );
  expectEqual(
    "Messenger message too long",
    replyProblem("facebook", "a".repeat(2001), true),
    "Keep it to 2,000 characters.",
  );
  expectEqual("Messenger message fine", replyProblem("facebook", "a".repeat(2000), true), null);
  expectEqual("Instagram counts bytes", replyLength("instagram", true, "hi \u{1F600}"), 7);
  expectEqual("comments count characters", replyLength("instagram", false, "hi \u{1F600}"), 5);
  expectEqual(
    "Instagram message too long with emoji",
    replyProblem("instagram", "\u{1F600}".repeat(300), true),
    "Keep it shorter. Instagram takes about 1,000 letters in a message, fewer with emoji.",
  );
  const clipped = readReplySuggestion({ reply: "\u{1F600}".repeat(300) }, "instagram", true).reply;
  expect(
    "Instagram message suggestion capped whole",
    replyLength("instagram", true, clipped) === 1000 && clipped === "\u{1F600}".repeat(250),
  );
}

console.log("Suggestion requests");
{
  expectEqual(
    "review read",
    parseReplyRequest({
      platform: "google",
      kind: "review",
      rating: 5,
      author: " Mary Smith ",
      text: " Great job ",
      earlier: [{ fromUs: true, text: "Thanks!" }, { fromUs: false, text: "  " }, "junk"],
      postText: "",
    }),
    {
      platform: "google",
      kind: "review",
      rating: 5,
      author: "Mary Smith",
      text: "Great job",
      earlier: [{ fromUs: true, text: "Thanks!" }],
      postText: null,
    },
  );
  expectEqual("no app", parseReplyRequest({ text: "hi" }), { error: "Say which app it's on." });
  const dm = parseReplyRequest({ platform: "instagram", kind: "message", text: "Ponsonby?" });
  expectEqual("message read", "error" in dm ? dm.error : dm.kind, "message");
  expectEqual(
    "no messages on Google",
    parseReplyRequest({ platform: "google", kind: "message", text: "hi" }),
    { error: "Google has no messages." },
  );
  expectEqual(
    "review off Google",
    parseReplyRequest({ platform: "facebook", kind: "review", text: "hi" }),
    { error: "Only Google has reviews." },
  );
  expectEqual("nothing to answer", parseReplyRequest({ platform: "facebook", text: "  " }), {
    error: "There's nothing to reply to.",
  });
  expect(
    "stars only is enough",
    !("error" in parseReplyRequest({ platform: "google", kind: "review", rating: 4 })),
  );
  const comment = parseReplyRequest({ platform: "facebook", rating: 5, text: "hi" });
  expectEqual("stars on a comment dropped", "error" in comment ? "error" : comment.rating, null);
  const high = parseReplyRequest({ platform: "google", kind: "review", rating: 9, text: "hi" });
  expectEqual("stars capped", "error" in high ? "error" : high.rating, 5);
  const long = parseReplyRequest({ platform: "instagram", text: "a".repeat(3000) });
  expectEqual("long words cut", "error" in long ? "error" : long.text.length, 2000);
  const many = parseReplyRequest({
    platform: "facebook",
    text: "hi",
    earlier: Array.from({ length: 15 }, (_, i) => ({ fromUs: false, text: `m${i}` })),
  });
  expectEqual(
    "last 10 earlier kept",
    "error" in many ? "error" : [many.earlier.length, many.earlier[0]?.text],
    [10, "m5"],
  );
}

console.log("Review post brief");
{
  expectEqual(
    "named, with stars",
    reviewBrief(" Fixed my laptop fast. ", "Mary Smith", 5),
    "Fixed my laptop fast.\n\nMary, Google review, 5 stars",
  );
  expectEqual("anonymous, no stars", reviewBrief("Great.", null, null), "Great.\n\nGoogle review");
  const cut = reviewBrief("a".repeat(600), "Mary", 4);
  expect(
    "long review cut to fit",
    cut.length === 500 && cut.endsWith("...\n\nMary, Google review, 4 stars"),
  );
}

console.log("Times");
{
  const now = NOW.getTime();
  expectEqual("within the day", listWhen(ago(5).toISOString(), now), "5 min ago");
  expectEqual("this year", listWhen("2026-10-19T03:00:00.000Z", now), "19 Oct");
  expectEqual("last year", listWhen("2025-12-30T03:00:00.000Z", now), "30 Dec 2025");
  const thisYear = messageWhen("2026-10-21T20:05:00.000Z", now).replace(/\s/g, " ");
  expect("message this year", /^Thu,? 22 Oct.* 9:05 am$/i.test(thisYear), thisYear);
  const lastYear = messageWhen("2025-12-30T03:00:00.000Z", now);
  expect("message last year has the year", lastYear.includes("2025"), lastYear);
}

finish();
