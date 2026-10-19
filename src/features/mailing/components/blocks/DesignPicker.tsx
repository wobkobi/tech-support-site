"use client";
// src/features/mailing/components/blocks/DesignPicker.tsx
// "Use a design" for the mail Picture block: post maker designs' stored pictures, one button
// per size. Works with uploads off; Post maker links open a new tab.

import { Modal } from "@/features/admin/components/ui/Modal";
import { callApi } from "@/features/mailing/lib/api-client";
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";

/** One stored size of a design. */
interface DesignPicture {
  format: string;
  label: string;
  url: string;
  width: number;
  height: number;
}

/** A design on offer, as the pictures route sends it. */
interface DesignPictures {
  id: string;
  name: string;
  alt: string;
  current: boolean;
  pictures: DesignPicture[];
}

/** What picking a size hands back. */
export interface PickedDesign {
  url: string;
  /** The design's picture description, or "" when it has none. */
  alt: string;
}

/**
 * Design picker dialog. Renders nothing when closed, so each opening fetches afresh.
 * @param props - Component props.
 * @param props.open - Whether the dialog shows.
 * @param props.onPick - Uses one size of a design.
 * @param props.onClose - Closes without picking.
 * @returns Dialog element.
 */
export function DesignPicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (picked: PickedDesign) => void;
  onClose: () => void;
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Use a design"
      description="Pictures made in Post maker. Wide sizes read best in an email."
      size="lg"
    >
      <PickerBody onPick={onPick} />
    </Modal>
  );
}

/**
 * The picker's contents: each design with a button per size.
 * @param props - Component props.
 * @param props.onPick - Uses one size of a design.
 * @returns Body element.
 */
function PickerBody({ onPick }: { onPick: (picked: PickedDesign) => void }): React.ReactElement {
  const [designs, setDesigns] = useState<DesignPictures[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void callApi<{ designs: DesignPictures[] }>("/api/admin/social/designs/pictures").then(
      (res) => {
        if (!live) return;
        if (res.ok) setDesigns(res.designs);
        else setError(res.error);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="text-sm text-coquelicot-700">{error}</p>;
  if (designs === null) return <p className="text-sm text-admin-muted">Loading...</p>;
  if (designs.length === 0) {
    return (
      <p className="text-sm text-admin-text-secondary">
        No designs have pictures yet. Make one in{" "}
        <Link
          href="/admin/social/design"
          target="_blank"
          rel="noopener"
          className="font-semibold underline"
        >
          Post maker
        </Link>
        , then press Pictures there to draw them.
      </p>
    );
  }
  return (
    <ul className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
      {designs.map((d) => (
        <li key={d.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-semibold text-admin-text">{d.name}</h3>
            {!d.current && (
              <span className="text-sm text-amber-700">
                Changed since these were drawn.{" "}
                <Link
                  href={`/admin/social/design/${d.id}`}
                  target="_blank"
                  rel="noopener"
                  className="underline"
                >
                  Update them in Post maker
                </Link>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {d.pictures.map((p) => (
              <button
                key={p.format}
                type="button"
                onClick={() => onPick({ url: p.url, alt: d.alt })}
                className="flex w-32 flex-col items-center gap-1 rounded-md border border-admin-border bg-admin-surface p-1.5 hover:ring-2 hover:ring-moonstone-600"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Blob picture shown small; next/image adds nothing here. */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="max-h-28 w-full rounded-sm object-contain"
                />
                <span className="text-sm text-admin-text">{p.label}</span>
                <span className="sr-only">
                  Use the {p.label} picture of {d.name}
                </span>
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
