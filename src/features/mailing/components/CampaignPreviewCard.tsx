"use client";
// src/features/mailing/components/CampaignPreviewCard.tsx
// The editor's preview card: any renderer problems, the inbox row, and the real email HTML in a
// sandboxed white frame. The frame grows to the whole email, so the page scrolls through it.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** The preview route's answer. */
export interface CampaignPreview {
  html: string;
  subject: string;
  /** Sender name the inbox shows. */
  from: string;
  /** Preview text, then the start of the email, as an inbox runs them together. */
  inboxLine: string;
  problems: string[];
}

/**
 * Preview card for the email editor.
 * @param props - Component props.
 * @param props.preview - Latest rendered preview, or undefined while the first one loads.
 * @param props.width - Frame width: desktop or phone.
 * @param props.onWidth - Switches the frame width.
 * @returns Preview card element.
 */
export function CampaignPreviewCard({
  preview,
  width,
  onWidth,
}: {
  preview: CampaignPreview | undefined;
  width: "desktop" | "phone";
  onWidth: (w: "desktop" | "phone") => void;
}): React.ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  // Kept while a refresh loads, so the page below doesn't jump as you type.
  const [height, setHeight] = useState<number>();

  /** Sizes the frame to the email's full height, border included. */
  const fit = useCallback(() => {
    const el = frame.current;
    const body = el?.contentDocument?.body;
    // Before the first preview lands the frame is empty and measures 0; keep the placeholder.
    const h = Math.ceil(body?.getBoundingClientRect().height ?? 0);
    if (!el || !h) return;
    setHeight(h + el.offsetHeight - el.clientHeight);
  }, []);

  // A new width reflows the email, so its height changes with it.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <Card className="xl:self-start">
      <CardHeader
        title="Preview"
        description={preview ? undefined : "Loading..."}
        actions={
          <div className={SEGMENTED_GROUP_CLS}>
            {(["desktop", "phone"] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={width === w}
                onClick={() => onWidth(w)}
                className={segmentedButtonClass(width === w)}
              >
                {w === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex flex-col gap-3">
        {preview && preview.problems.length > 0 && (
          <ul className="list-disc rounded-lg border border-amber-300 bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-900">
            {preview.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {preview && (
          <figure
            className={cn(
              "flex items-start gap-3 rounded-lg border border-admin-border bg-white p-3 text-sm text-neutral-900",
              width === "phone" && "mx-auto w-93.75 max-w-full",
            )}
          >
            <figcaption className="sr-only">In the inbox of Sam, a sample reader</figcaption>
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 font-semibold text-neutral-700"
            >
              {preview.from.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{preview.from}</p>
              <p className="truncate font-semibold">{preview.subject || "(no subject)"}</p>
              <p
                className={cn("text-neutral-600", width === "phone" ? "line-clamp-2" : "truncate")}
              >
                {preview.inboxLine}
              </p>
            </div>
          </figure>
        )}
        <div className="flex justify-center rounded-lg bg-admin-bg p-2">
          {/* Same origin so its height can be read; no scripts, so the email still can't run any. */}
          <iframe
            ref={frame}
            srcDoc={preview?.html ?? ""}
            title="Email preview"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={fit}
            style={{ height: height ?? "60vh" }}
            className={cn(
              "rounded-lg border border-admin-border bg-white",
              width === "desktop" ? "w-full" : "w-93.75 max-w-full",
            )}
          />
        </div>
      </div>
    </Card>
  );
}
