// src/features/social/lib/to-email.ts
// Turns a social post into the start of a mailing-list email for Email this too: hashtags and
// emoji out, paragraphs as Text blocks, the link as a button. Pure and client-safe.

import {
  fillBlocks,
  placePicture,
  POST_SOURCE_MAX,
  type AiDraft,
} from "@/features/mailing/lib/ai-draft";
import { parseBlocks, serializeBlocks } from "@/features/mailing/lib/blocks";
import { BLANK_TEMPLATE } from "@/features/mailing/lib/templates";

/** Longer subjects get cut off in a phone's inbox. */
export const EMAIL_SUBJECT_MAX = 60;

/** The button a post's link becomes. */
export const POST_LINK_BUTTON = "Find out more";

// Emoji plus the invisible parts that build them: skin tones, flag letters, joiners and the
// emoji-style selector. Extended_Pictographic also covers the copyright, registered and
// trademark signs, which are words in an email, so the lookahead keeps them.
const EMOJI_RE =
  /(?![©®™])[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Variation_Selector}\p{Join_Control}]/gu;
// A tag needs a letter, so "#1" in "I'm #1 for house calls" stays as written.
const TAG = String.raw`#(?=[\p{N}_]*\p{L})[\p{L}\p{N}_]+`;
// Tags ending a line, or making up the whole line: the block apps put under a post.
const TRAILING_TAGS_RE = new RegExp(String.raw`(?:^|\s+)(?:${TAG}\s*)+$`, "u");
// A word that needs what follows it, so a tag after it is part of the sentence ("ask me in
// #Titirangi"), not the decoration after one ("on Tuesday #Tips").
const JOINING_WORD_RE =
  /\b(?:in|at|on|from|to|near|around|across|for|of|with|about|into|the|a|an|my|your|our|their)$/i;
// A tag inside a sentence keeps its word: "help in #Titirangi" > "help in Titirangi".
const INLINE_TAG_RE = new RegExp(String.raw`(^|\s)#((?=[\p{N}_]*\p{L})[\p{L}\p{N}_]+)`, "gu");

/** The parts of a post an email is made from. */
export interface PostForEmail {
  name: string;
  body: string;
  linkUrl: string | null;
  targets: readonly { platform: string; textOverride: string | null }[];
}

/** A post turned into an email: its subject and block body. */
export interface EmailFromPost {
  subject: string;
  body: string;
}

/**
 * Takes the tags off the end of a line. When the line runs into them from a joining word, the
 * first tag is the sentence's last word, so it stays for the # to come off.
 * @param line - One line, emoji already out.
 * @returns The line without its trailing tags.
 */
function dropTrailingTags(line: string): string {
  const match = TRAILING_TAGS_RE.exec(line);
  if (!match) return line;
  const before = line.slice(0, match.index);
  if (!JOINING_WORD_RE.test(before)) return before;
  return `${before} ${match[0].trim().split(/\s+/)[0]}`;
}

/**
 * A post's words with what only works on social taken out: emoji, the hashtag block, tags ending
 * a line, and the # of a tag inside a sentence. Spaces an emoji leaves before punctuation close up.
 * @param text - Post text.
 * @returns Plain text, paragraphs kept apart by a blank line.
 */
export function stripSocial(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(EMOJI_RE, "")
    .split("\n")
    .map((line) =>
      dropTrailingTags(line)
        .replace(INLINE_TAG_RE, "$1$2")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([.,!?;:])/g, "$1")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The post's Facebook words, stripped for email: Facebook's are the fullest version, with no
 * Instagram "link in bio" and no cut for Google.
 * @param post - The post.
 * @returns The words, or "" when the post has none.
 */
function postWords(post: PostForEmail): string {
  const own = post.targets.find((t) => t.platform === "facebook")?.textOverride;
  return stripSocial(own?.trim() ? own : post.body);
}

/**
 * The post's name as a subject, cut at a word near {@link EMAIL_SUBJECT_MAX}.
 * @param name - Post name.
 * @returns The subject.
 */
function subjectOf(name: string): string {
  const flat = name.replace(/\s+/g, " ").trim();
  if (flat.length <= EMAIL_SUBJECT_MAX) return flat;
  const space = flat.slice(0, EMAIL_SUBJECT_MAX + 1).lastIndexOf(" ");
  return (space > 20 ? flat.slice(0, space) : flat.slice(0, EMAIL_SUBJECT_MAX)).trim();
}

/**
 * Builds an email from a post without AI: the blank email's greeting, then each paragraph as a
 * Text block, a {@link POST_LINK_BUTTON} button when the post has a link, and the picture under
 * the greeting. Uses the same fill as Draft with AI, so redrafting later swaps the words in place.
 * @param post - The post.
 * @param picture - The picture to put in, or null for none.
 * @returns The subject and body.
 */
export function emailFromPost(
  post: PostForEmail,
  picture: { url: string; alt: string } | null,
): EmailFromPost {
  const draft: AiDraft = {
    subject: "",
    preheader: "",
    heading: "",
    paragraphs: postWords(post)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean),
    bullets: [],
    buttonText: post.linkUrl ? POST_LINK_BUTTON : "",
    buttonUrl: post.linkUrl ?? "",
    picture: "",
  };
  const blocks = fillBlocks(parseBlocks(BLANK_TEMPLATE.body), draft);
  return {
    subject: subjectOf(post.name),
    body: serializeBlocks(picture ? placePicture(blocks, picture) : blocks),
  };
}

/**
 * The post as a Draft with AI brief: its stripped words, capped at {@link POST_SOURCE_MAX}.
 * @param post - The post.
 * @returns The brief, or "" when the post has no words.
 */
export function postBrief(post: PostForEmail): string {
  return postWords(post).slice(0, POST_SOURCE_MAX);
}
