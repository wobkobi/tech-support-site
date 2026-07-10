// src/features/admin/components/ui/ConfirmDialog.tsx
/**
 * @description Styled confirmation dialog built on {@link Modal}, replacing
 * `window.confirm`. A "danger" tone renders the confirm button in coquelicot;
 * `busy` shows a spinner and blocks dismissal while the action runs.
 */

"use client";

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import type React from "react";

/** Props for {@link ConfirmDialog}. */
interface ConfirmDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Dialog title. */
  title: string;
  /** Optional explanatory body. */
  body?: React.ReactNode;
  /** Confirm button label (defaults to "Confirm"). */
  confirmLabel?: string;
  /** Cancel button label (defaults to "Cancel"). */
  cancelLabel?: string;
  /** "danger" renders the confirm button in coquelicot. */
  tone?: "default" | "danger";
  /** Shows a spinner on confirm and disables both buttons. */
  busy?: boolean;
  /** Confirm handler. */
  onConfirm: () => void;
  /** Cancel / dismiss handler. */
  onCancel: () => void;
}

/**
 * Confirmation dialog with Cancel / Confirm actions.
 * @param props - Component props.
 * @param props.open - Whether the dialog is shown.
 * @param props.title - Dialog title.
 * @param props.body - Optional explanatory body.
 * @param props.confirmLabel - Confirm button label.
 * @param props.cancelLabel - Cancel button label.
 * @param props.tone - "default" or "danger".
 * @param props.busy - Whether the confirm action is in flight.
 * @param props.onConfirm - Confirm handler.
 * @param props.onCancel - Cancel / dismiss handler.
 * @returns The dialog element.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Modal
      open={open}
      // Block backdrop/Escape dismissal while the action is running.
      onClose={busy ? () => undefined : onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <AdminButton variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </AdminButton>
          <AdminButton
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            busy={busy}
          >
            {confirmLabel}
          </AdminButton>
        </>
      }
    >
      <div className="text-sm text-admin-text-secondary">
        {body ?? "This action cannot be undone."}
      </div>
    </Modal>
  );
}
