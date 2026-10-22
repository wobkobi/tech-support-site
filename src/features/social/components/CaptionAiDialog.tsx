"use client";
// src/features/social/components/CaptionAiDialog.tsx
// Write with AI for a post's words: new options from a brief, or a change to what's written.
// Each option shows its length and any new problem before you pick it. Nothing is saved here.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import {
  CAPTION_ACTIONS,
  CAPTION_BRIEF_MAX,
  CAPTION_ENDINGS,
  CAPTION_KINDS,
  CAPTION_LENGTHS,
  MAX_CAPTION_OPTIONS,
  hashtagsOnByDefault,
  type CaptionAction,
  type CaptionEnding,
  type CaptionLength,
} from "@/features/social/lib/caption-ai";
import type { CaptionAiSetup } from "@/features/social/lib/open-post";
import {
  FACEBOOK_MAX_CHARS,
  GOOGLE_MAX_CHARS,
  INSTAGRAM_MAX_CHARS,
  PLATFORM_LABEL,
  charCount,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useState } from "react";

const MAX_CHARS: Record<SocialPlatformKey, number> = {
  facebook: FACEBOOK_MAX_CHARS,
  instagram: INSTAGRAM_MAX_CHARS,
  google: GOOGLE_MAX_CHARS,
};

/** Where a picked option goes: over the post, under it, or as one app's own text. */
export type CaptionPlacement = "replace" | "add" | SocialPlatformKey;

type Tab = "write" | "change";

/**
 * The counter's limit: the strictest app the words go to, capped at Instagram's, which no
 * option runs past.
 * @param only - The one app the words are for, or null for every app the post goes to.
 * @param enabled - Apps the post goes to.
 * @returns Most characters.
 */
function maxChars(only: SocialPlatformKey | null, enabled: readonly SocialPlatformKey[]): number {
  return Math.min(INSTAGRAM_MAX_CHARS, ...(only ? [only] : enabled).map((p) => MAX_CHARS[p]));
}

/**
 * The Write with AI dialog.
 * @param props - Component props.
 * @param props.setup - Starting choices from the brand profile.
 * @param props.textOf - The words now: the post's, or one app's when it has its own.
 * @param props.enabled - Apps the post goes to.
 * @param props.promoId - The post's linked promo, or null.
 * @param props.issuesFor - Problems an option would add, for all the post's apps or one.
 * @param props.onUse - Puts a picked option in the post.
 * @param props.onClose - Dismisses it.
 * @returns The dialog.
 */
export function CaptionAiDialog({
  setup,
  textOf,
  enabled,
  promoId,
  issuesFor,
  onUse,
  onClose,
}: {
  setup: CaptionAiSetup;
  textOf: (only: SocialPlatformKey | null) => string;
  enabled: SocialPlatformKey[];
  promoId: string | null;
  issuesFor: (text: string, only: SocialPlatformKey | null) => string[];
  onUse: (text: string, where: CaptionPlacement) => void;
  onClose: () => void;
}): React.ReactElement {
  const id = useId();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("write");
  const [brief, setBrief] = useState("");
  const [kind, setKind] = useState<string>("general");
  const [length, setLength] = useState<CaptionLength>("medium");
  const [ending, setEnding] = useState<CaptionEnding>("none");
  const [only, setOnly] = useState<SocialPlatformKey | null>(null);
  // Null follows the brand profile's default for the apps picked; a tick or untick sticks.
  const [hashtagsPick, setHashtagsPick] = useState<boolean | null>(null);
  const [emoji, setEmoji] = useState(setup.emoji);
  const [count, setCount] = useState(MAX_CAPTION_OPTIONS);
  const [busy, setBusy] = useState<string | null>(null);
  const [options, setOptions] = useState<string[] | null>(null);
  const [optionsFor, setOptionsFor] = useState<SocialPlatformKey | null>(null);

  const platforms = only ? [only] : enabled;
  const current = textOf(only);
  const hasWords = current.trim() !== "";
  const googleOnly = only === "google" || (enabled.length === 1 && enabled[0] === "google");
  const hashtags = !googleOnly && (hashtagsPick ?? hashtagsOnByDefault(setup.hashtags, platforms));
  const example = CAPTION_KINDS.find((k) => k.key === kind)?.example ?? "";

  /**
   * Asks for options and shows them.
   * @param action - The change to make, or null to write new words.
   */
  async function ask(action: CaptionAction | null): Promise<void> {
    setBusy(action ?? "write");
    const res = await callApi<{ captions: string[] }>("/api/admin/social/caption-ai", "POST", {
      mode: action ? "rewrite" : "write",
      brief: action ? current : brief,
      action,
      kind,
      length,
      hashtags,
      emoji,
      ending,
      platforms,
      count: action === "fix" ? 1 : action ? Math.min(count, 2) : count,
      promoId,
    });
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setOptions(res.captions);
    setOptionsFor(only);
  }

  /**
   * Hands an option over and closes.
   * @param text - The option.
   * @param where - Where it goes.
   */
  function use(text: string, where: CaptionPlacement): void {
    onUse(text, where);
    onClose();
  }

  const appChoice = enabled.length > 1 && (
    <AdminField
      label="Words for"
      htmlFor={`${id}-for`}
      hint="Words for one app go in that app's own text, so the others keep the post as it is."
    >
      <AdminSelect
        id={`${id}-for`}
        value={only ?? ""}
        onChange={(e) => setOnly((e.target.value || null) as SocialPlatformKey | null)}
      >
        <option value="">Every app this post goes to</option>
        {enabled.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABEL[p]} only
          </option>
        ))}
      </AdminSelect>
    </AdminField>
  );

  const endingChoice = (
    <AdminField label="Ending" htmlFor={`${id}-ending`}>
      <AdminSelect
        id={`${id}-ending`}
        value={ending}
        onChange={(e) => setEnding(e.target.value as CaptionEnding)}
      >
        {CAPTION_ENDINGS.map((e) => (
          <option key={e.key} value={e.key}>
            {e.label}
          </option>
        ))}
      </AdminSelect>
    </AdminField>
  );

  return (
    <Modal
      open
      size="lg"
      onClose={busy ? () => {} : onClose}
      title="Write with AI"
      description="The options are only suggestions: pick one to put in the post, then read it and change anything before it goes out."
      dirty={brief.trim() !== "" || options !== null}
      footer={
        <>
          <AdminButton variant="secondary" disabled={busy !== null} onClick={onClose}>
            Close
          </AdminButton>
          {tab === "write" && (
            <AdminButton
              busy={busy === "write"}
              disabled={!brief.trim() || (busy !== null && busy !== "write")}
              onClick={() => void ask(null)}
            >
              {options ? "Write again" : "Write"}
            </AdminButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AdminTabs
          aria-label="What to do"
          tabs={[
            { key: "write", label: "Write new words" },
            { key: "change", label: "Change what's there" },
          ]}
          active={tab}
          onSelect={(key) => setTab(key)}
        />

        {tab === "write" ? (
          <>
            <AdminField
              label="What it's about"
              htmlFor={`${id}-brief`}
              hint={`${brief.length} of ${CAPTION_BRIEF_MAX} characters. Put in any dates or prices you want used; it won't make them up.`}
            >
              <AdminTextarea
                id={`${id}-brief`}
                rows={3}
                maxLength={CAPTION_BRIEF_MAX}
                value={brief}
                placeholder={example}
                onChange={(e) => setBrief(e.target.value)}
              />
            </AdminField>
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField label="Kind of post" htmlFor={`${id}-kind`}>
                <AdminSelect
                  id={`${id}-kind`}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {CAPTION_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
              <AdminField label="Length" htmlFor={`${id}-length`}>
                <AdminSelect
                  id={`${id}-length`}
                  value={length}
                  onChange={(e) => setLength(e.target.value as CaptionLength)}
                >
                  {CAPTION_LENGTHS.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
              {endingChoice}
              <AdminField label="Options to pick from" htmlFor={`${id}-count`}>
                <AdminSelect
                  id={`${id}-count`}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {Array.from({ length: MAX_CAPTION_OPTIONS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
            </div>
            {appChoice}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <AdminCheckbox
                checked={hashtags}
                disabled={googleOnly}
                onChange={setHashtagsPick}
                label={googleOnly ? "Hashtags (not on Google)" : "Hashtags"}
              />
              <AdminCheckbox checked={emoji} onChange={setEmoji} label="Emoji (one or two)" />
            </div>
          </>
        ) : !hasWords ? (
          <p className="text-sm text-admin-text-secondary">
            Write the post first, or use Write new words, then come back here to change it.
          </p>
        ) : (
          <>
            <p className="text-sm text-admin-text-secondary">
              Changes the post&apos;s words as they are now. Fixing spelling and grammar leaves
              everything else alone.
            </p>
            <div className="flex flex-wrap gap-2">
              {CAPTION_ACTIONS.map((a) => (
                <AdminButton
                  key={a.key}
                  variant="outline"
                  busy={busy === a.key}
                  disabled={busy !== null && busy !== a.key}
                  onClick={() => void ask(a.key)}
                >
                  {a.label}
                </AdminButton>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {endingChoice}
              {appChoice}
            </div>
          </>
        )}

        {options && (
          <section aria-label="Options" className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-admin-text">
              {options.length === 1 ? "Here it is" : `Pick one of ${options.length}`}
            </h3>
            {options.map((text, i) => {
              const problems = issuesFor(text, optionsFor);
              const max = maxChars(optionsFor, enabled);
              const count = charCount(text);
              const tooLong = count > max;
              return (
                <div
                  key={`${i}-${text.slice(0, 20)}`}
                  className="flex flex-col gap-2 rounded-lg border border-admin-border bg-admin-bg p-3"
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-admin-text">
                    {text}
                  </p>
                  <p
                    className={cn(
                      "text-sm tabular-nums",
                      tooLong ? "text-red-700" : "text-admin-muted",
                    )}
                  >
                    {count.toLocaleString()} / {max.toLocaleString()} characters
                  </p>
                  {problems.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-amber-800">
                      {problems.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {optionsFor ? (
                      <AdminButton size="xs" onClick={() => use(text, optionsFor)}>
                        Use for {PLATFORM_LABEL[optionsFor]} only
                      </AdminButton>
                    ) : (
                      <>
                        <AdminButton size="xs" onClick={() => use(text, "replace")}>
                          {hasWords ? "Use instead of what's there" : "Use this"}
                        </AdminButton>
                        {hasWords && tab === "write" && (
                          <AdminButton size="xs" variant="outline" onClick={() => use(text, "add")}>
                            Add under what&apos;s there
                          </AdminButton>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </Modal>
  );
}
