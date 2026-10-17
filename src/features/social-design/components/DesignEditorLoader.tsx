"use client";
// src/features/social-design/components/DesignEditorLoader.tsx
// Loads the post maker editor in the browser only. Konva draws on a real canvas and
// has no server build, and next/dynamic's ssr: false only works from a client component.

import type { DesignRow } from "@/features/social-design/lib/design-row";
import type { BoundValues } from "@/features/social-design/lib/doc";
import dynamic from "next/dynamic";
import type React from "react";

const DesignEditor = dynamic(
  () => import("@/features/social-design/components/DesignEditor").then((m) => m.DesignEditor),
  {
    ssr: false,
    /**
     * Shown while the editor's code loads.
     * @returns Placeholder line.
     */
    loading: () => <p className="py-10 text-center text-admin-muted">Opening the editor...</p>,
  },
);

/**
 * Browser-only editor.
 * @param props - Component props.
 * @param props.initial - Design as loaded.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.canUpload - Whether photo uploads are set up.
 * @param props.bookingUrl - Booking page address, where a new QR code points.
 * @param props.canDraft - Whether "Draft with AI" is available (OpenAI is set up).
 * @returns Editor element.
 */
export function DesignEditorLoader(props: {
  initial: DesignRow;
  bound: BoundValues;
  canUpload: boolean;
  bookingUrl: string;
  canDraft: boolean;
}): React.ReactElement {
  return <DesignEditor {...props} />;
}
