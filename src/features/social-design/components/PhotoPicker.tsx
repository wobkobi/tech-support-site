"use client";
// src/features/social-design/components/PhotoPicker.tsx
// The post maker's photo picker: upload a new photo, or reuse one already in a design.
// Reusing works with uploads switched off, since those photos are already stored.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { callApi } from "@/features/mailing/lib/api-client";
import type React from "react";
import { useEffect, useState } from "react";
import { FaUpload } from "react-icons/fa6";

/** A photo already used in a design. */
export interface RecentPhoto {
  url: string;
  /** Recorded size, or null when the photo needs loading to find it. */
  width: number | null;
  height: number | null;
}

/**
 * Photo picker dialog. Renders nothing when closed, so each opening fetches afresh.
 * @param props - Component props.
 * @param props.open - Whether the dialog shows.
 * @param props.title - Dialog title, saying what the photo is for.
 * @param props.canUpload - Whether photo uploads are set up.
 * @param props.onUpload - Opens the file picker for a new photo.
 * @param props.onPick - Uses a recent photo.
 * @param props.onClose - Closes without picking.
 * @returns Dialog element.
 */
export function PhotoPicker({
  open,
  title,
  canUpload,
  onUpload,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  canUpload: boolean;
  onUpload: () => void;
  onPick: (photo: RecentPhoto) => void;
  onClose: () => void;
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <PickerBody canUpload={canUpload} onUpload={onUpload} onPick={onPick} />
    </Modal>
  );
}

/**
 * The picker's contents: the upload button and the recent photos.
 * @param props - Component props.
 * @param props.canUpload - Whether photo uploads are set up.
 * @param props.onUpload - Opens the file picker for a new photo.
 * @param props.onPick - Uses a recent photo.
 * @returns Body element.
 */
function PickerBody({
  canUpload,
  onUpload,
  onPick,
}: {
  canUpload: boolean;
  onUpload: () => void;
  onPick: (photo: RecentPhoto) => void;
}): React.ReactElement {
  const [photos, setPhotos] = useState<RecentPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void callApi<{ photos: RecentPhoto[] }>("/api/admin/social/designs/photos").then((res) => {
      if (!live) return;
      if (res.ok) setPhotos(res.photos);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <AdminButton onClick={onUpload} disabled={!canUpload}>
          <FaUpload aria-hidden className="size-3.5" /> Upload a photo...
        </AdminButton>
        {!canUpload && (
          <span className="text-sm text-admin-muted">
            Uploads are off until Blob storage is set up. You can still reuse a photo below.
          </span>
        )}
      </div>
      <section aria-labelledby="recent-photos" className="flex flex-col gap-2">
        <h3 id="recent-photos" className="text-sm font-semibold text-admin-text-secondary">
          Photos already in your designs
        </h3>
        {error ? (
          <p className="text-sm text-coquelicot-700">{error}</p>
        ) : photos === null ? (
          <p className="text-sm text-admin-muted">Loading...</p>
        ) : photos.length === 0 ? (
          <p className="text-sm text-admin-muted">
            None yet. Photos you upload show here, ready to use again.
          </p>
        ) : (
          <ul className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {photos.map((p) => (
              <li key={p.url}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="block aspect-square w-full overflow-hidden rounded-md border border-admin-border bg-seasalt-100 hover:ring-2 hover:ring-moonstone-600"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Blob photo shown small; next/image adds nothing here. */}
                  <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />
                  <span className="sr-only">Use this photo</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
