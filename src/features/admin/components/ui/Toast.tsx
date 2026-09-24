// src/features/admin/components/ui/Toast.tsx
// Global admin toast system. AdminToastProvider mounts a bottom-right stack (mounted once
// by the admin layout); useToast returns a `toast(message, opts)` function. Info, success
// and warning toasts auto-dismiss (4s, or 6s for a warning) and are announced politely.
// Error toasts are announced assertively and stay until dismissed, so a failure that
// lands while the operator is looking elsewhere is still there when they look back.

"use client";

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

/** Toast tone. */
type ToastTone = "info" | "success" | "warning" | "error";

/** Options accepted by {@link ToastApi.toast}. */
interface ToastOptions {
  /** Visual tone (defaults to "info"). */
  tone?: ToastTone;
  /** Auto-dismiss delay in milliseconds. Errors stay until dismissed unless this is set. */
  duration?: number;
}

/** The value returned by {@link useToast}. */
interface ToastApi {
  /**
   * Shows a toast.
   * @param message - The message text.
   * @param options - Optional tone and duration.
   */
  toast: (message: string, options?: ToastOptions) => void;
}

/** An on-screen toast. */
interface ActiveToast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Props for {@link AdminToastProvider}. */
interface AdminToastProviderProps {
  /** The subtree that can raise toasts. */
  children: React.ReactNode;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Tone classes for a toast card.
 * @param tone - Toast tone.
 * @returns Class string.
 */
function toastToneClass(tone: ToastTone): string {
  switch (tone) {
    case "info":
      return "border-admin-border-strong bg-admin-surface text-admin-text";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "error":
      return "border-coquelicot-200 bg-coquelicot-100 text-coquelicot-800";
  }
}

/**
 * One toast card with its dismiss button.
 * @param props - Component props.
 * @param props.toast - The toast to render.
 * @param props.onDismiss - Removes the toast.
 * @returns The toast card.
 */
function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ActiveToast;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg border py-1 pr-1 pl-4 text-sm font-medium shadow-lg",
        toastToneClass(toast.tone),
      )}
    >
      <p className="flex-1 py-2">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-current"
      >
        <FaXmark className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Provides the toast API and renders the toast stack. Mount once near the root
 * of the admin tree.
 * @param props - Component props.
 * @param props.children - The subtree that can raise toasts.
 * @returns The provider with its toast region.
 */
export function AdminToastProvider({ children }: AdminToastProviderProps): React.ReactElement {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options?: ToastOptions): void => {
      const tone = options?.tone ?? "info";
      const duration =
        options?.duration ?? (tone === "error" ? undefined : tone === "warning" ? 6000 : 4000);
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      if (duration !== undefined) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const errors = toasts.filter((t) => t.tone === "error");
  const others = toasts.filter((t) => t.tone !== "error");

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Two live regions rather than a role per card: a region has to exist
          before its content changes to be announced reliably, and nesting an
          alert inside a polite region reads it twice in some screen readers.
          --phone-bar-h (globals.css) lifts the stack above a phone action bar. */}
      <div className="pointer-events-none fixed right-4 bottom-[calc(1rem+var(--phone-bar-h,0px))] z-60 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 print:hidden">
        <div aria-live="assertive" className="flex flex-col gap-2">
          {errors.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
        <div aria-live="polite" className="flex flex-col gap-2">
          {others.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Returns the toast API. Must be called within an {@link AdminToastProvider}.
 * @returns The toast API.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within an AdminToastProvider");
  }
  return ctx;
}
