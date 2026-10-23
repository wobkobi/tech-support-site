"use client";
// src/features/social-design/components/GoneOutDesign.tsx
// A design that has gone out, shown in place of the editor: where it went, its pictures as they
// went out, and Make a copy to change it. Its pictures can still go in a new post as they are.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { DesignSummary, RenderRow } from "@/features/social-design/lib/design-row";
import { FORMATS } from "@/features/social-design/lib/formats";
import type { GoneOut } from "@/features/social-design/lib/gone-out.server";
import { postHref } from "@/features/social/lib/links";
import { Notice } from "@/shared/components/Notice";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/**
 * The locked view of a design that has gone out.
 * @param props - Component props.
 * @param props.designId - The design.
 * @param props.pictures - Its exported pictures, in the design's size order.
 * @param props.goneOut - The posts and emails its pictures went out in.
 * @param props.canPost - Whether its post pictures match it as it is now, so they can go in a
 *   new post; a contact detail or promo that has changed since leaves them out of date.
 * @returns The view.
 */
export function GoneOutDesign({
  designId,
  pictures,
  goneOut,
  canPost,
}: {
  designId: string;
  pictures: readonly RenderRow[];
  goneOut: GoneOut;
  canPost: boolean;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"copy" | "post" | null>(null);

  /** Copies the design and opens the copy in the editor. */
  async function copy(): Promise<void> {
    setBusy("copy");
    const res = await callApi<{ design: DesignSummary }>("/api/admin/social/designs", "POST", {
      source: "copy",
      sourceId: designId,
    });
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/social/design/${res.design.id}`);
  }

  /** Puts the pictures in a new draft post as they are, and opens it. */
  async function post(): Promise<void> {
    setBusy("post");
    const res = await callApi<{ postId: string; isContent: boolean }>(
      `/api/admin/social/designs/${designId}/use`,
      "POST",
    );
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(postHref({ id: res.postId, isContent: res.isContent }));
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info">
        <p className="font-semibold">This design has gone out, so it stays as it went out.</p>
        <p className="mt-1">
          To change it, make a copy and edit that. Its pictures can still go in a post or an email
          as they are.
        </p>
        <UseList label="Posted in" uses={goneOut.posts} href={(id) => postHref({ id })} />
        <UseList label="Sent in" uses={goneOut.emails} href={(id) => `/admin/mailing/${id}`} />
      </Notice>
      <div className="flex flex-wrap gap-2">
        <AdminButton busy={busy === "copy"} disabled={busy !== null} onClick={() => void copy()}>
          Make a copy
        </AdminButton>
        {canPost && (
          <AdminButton
            variant="secondary"
            busy={busy === "post"}
            disabled={busy !== null}
            onClick={() => void post()}
          >
            Use in a new post
          </AdminButton>
        )}
      </div>
      {pictures.length > 0 ? (
        // items-start: each picture keeps its own shape.
        <ul className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pictures.map((p) => (
            <li key={p.format}>
              <Card padding="none" className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- Blob picture of its own size, which next/image needs up front. */}
                <img src={p.url} alt="" className="h-auto w-full bg-seasalt-100" />
                <p className="p-3 text-base">
                  <span className="font-semibold">{FORMATS[p.format].label}</span>
                  <span className="block text-sm text-admin-text-secondary">
                    {FORMATS[p.format].usedFor}
                  </span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-admin-muted">No pictures were exported from it.</p>
      )}
    </div>
  );
}

/**
 * One line of where the design went out, linking each.
 * @param props - Component props.
 * @param props.label - What the line lists.
 * @param props.uses - The posts or emails.
 * @param props.href - Where one opens.
 * @returns The line, or nothing when the list is empty.
 */
function UseList({
  label,
  uses,
  href,
}: {
  label: string;
  uses: GoneOut["posts"];
  href: (id: string) => string;
}): React.ReactElement | null {
  if (uses.length === 0) return null;
  return (
    <p className="mt-2">
      {label}{" "}
      {uses.map((u, i) => (
        <span key={u.id}>
          {i > 0 && ", "}
          <Link href={href(u.id)} className="font-semibold underline">
            {u.name}
          </Link>
        </span>
      ))}
    </p>
  );
}
