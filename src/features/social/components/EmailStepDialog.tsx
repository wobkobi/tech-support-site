"use client";
// src/features/social/components/EmailStepDialog.tsx
// "Email this too?": makes a draft mailing-list email from the open post and links the two. It
// only ever makes a draft; with AI ticked it opens the email in Mailing with Draft with AI ready.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { EmailPictureSource } from "@/features/social/lib/email-step.server";
import { isBlobImageUrl } from "@/shared/lib/blob-image";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useState } from "react";

/**
 * The Email this too dialog.
 * @param props - Component props.
 * @param props.postId - The post the email is made from.
 * @param props.imageUrl - The post's picture, offered when it's one of the site's own uploads.
 * @param props.hasDesignPicture - Whether the post's design has a current wide picture.
 * @param props.aiReady - Whether Draft with AI is set up, which shows the AI tickbox.
 * @param props.afterPublish - Offered after publishing, so "Not for this post" turns it off.
 * @param props.onClose - Dismisses it.
 * @returns The dialog.
 */
export function EmailStepDialog({
  postId,
  imageUrl,
  hasDesignPicture,
  aiReady,
  afterPublish,
  onClose,
}: {
  postId: string;
  imageUrl: string | null;
  hasDesignPicture: boolean;
  aiReady: boolean;
  afterPublish: boolean;
  onClose: () => void;
}): React.ReactElement {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const hasPhoto = imageUrl !== null && isBlobImageUrl(imageUrl);
  const choices: { key: EmailPictureSource; label: string; hint: string }[] = [
    ...(hasDesignPicture
      ? [
          {
            key: "design" as const,
            label: "The post's design, wide",
            hint: "Its wide size from the Post maker, which suits an email best.",
          },
        ]
      : []),
    ...(hasPhoto
      ? [
          {
            key: "photo" as const,
            label: "The post's picture",
            hint: "The same picture the post uses.",
          },
        ]
      : []),
    { key: "none", label: "No picture", hint: "You can add one in Mailing." },
  ];
  const [picture, setPicture] = useState<EmailPictureSource>(choices[0]!.key);
  const [withAi, setWithAi] = useState(aiReady);
  const [busy, setBusy] = useState<"draft" | "skip" | null>(null);

  /** Makes the draft, then opens it in Mailing with AI, or says where it is. */
  async function draft(): Promise<void> {
    setBusy("draft");
    const res = await callApi<{ campaignId: string }>(`/api/admin/social/${postId}/email`, "POST", {
      picture,
    });
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      // Another tab may have linked one; the Email card shows it after the refresh.
      router.refresh();
      onClose();
      return;
    }
    if (withAi && aiReady) {
      router.push(`/admin/mailing/${res.campaignId}?draft=post`);
      return;
    }
    setBusy(null);
    toast("Email draft made. Open it in Mailing from the Email card under the post.", {
      tone: "success",
    });
    router.refresh();
    onClose();
  }

  /** Stops offering it for this post. */
  async function skip(): Promise<void> {
    setBusy("skip");
    const res = await callApi(`/api/admin/social/${postId}/email`, "PATCH", { skipped: true });
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    onClose();
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Email this too?"
      description="This makes a draft email for your mailing list from this post. Nothing is sent: you check it and send it from Mailing."
      footer={
        <>
          {afterPublish && (
            <AdminButton
              variant="ghost"
              className="mr-auto"
              busy={busy === "skip"}
              disabled={busy !== null}
              onClick={() => void skip()}
            >
              Not for this post
            </AdminButton>
          )}
          <AdminButton variant="secondary" disabled={busy !== null} onClick={onClose}>
            {afterPublish ? "Later" : "Cancel"}
          </AdminButton>
          <AdminButton
            busy={busy === "draft"}
            disabled={busy !== null}
            onClick={() => void draft()}
          >
            Draft the email
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-admin-text">Picture</legend>
          {choices.map((c) => (
            <label
              key={c.key}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                picture === c.key
                  ? "border-russian-violet bg-admin-bg"
                  : "border-admin-border-strong bg-admin-surface",
              )}
            >
              <input
                type="radio"
                name={`${id}-picture`}
                checked={picture === c.key}
                onChange={() => setPicture(c.key)}
                className="mt-0.5 size-4 accent-russian-violet"
              />
              <span>
                <span className="block font-bold text-admin-text">{c.label}</span>
                <span className="text-admin-muted">{c.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {aiReady && (
          <div className="flex flex-col gap-1">
            <AdminCheckbox
              checked={withAi}
              onChange={setWithAi}
              label="Write it with AI"
              disabled={busy !== null}
            />
            <p className="text-sm text-admin-muted">
              {withAi
                ? "Mailing opens with Draft with AI ready to turn the post into an email: hashtags, emoji and follow-us lines come out."
                : "The email starts as a plain copy of the post's words, without hashtags or emoji."}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
