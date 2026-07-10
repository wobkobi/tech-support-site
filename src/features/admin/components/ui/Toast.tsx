// src/features/admin/components/ui/Toast.tsx
/**
 * @description Global admin toast system. {@link AdminToastProvider} mounts a
 * bottom-right stack (mounted once by the admin layout); {@link useToast}
 * returns a `toast(message, opts)` function. Toasts auto-dismiss (4s default,
 * 6s for warning/error) and the region is `aria-live="polite"`.
 */

"use client";

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

/** Toast tone. */
export type ToastTone = "info" | "success" | "warning" | "error";

/** Options accepted by {@link ToastApi.toast}. */
export interface ToastOptions {
  /** Visual tone (defaults to "info"). */
  tone?: ToastTone;
  /** Override the auto-dismiss delay, in milliseconds. */
  duration?: number;
}

/** The value returned by {@link useToast}. */
export interface ToastApi {
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
      return "border-coquelicot-800 bg-coquelicot-900 text-coquelicot-200";
  }
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

  const toast = useCallback((message: string, options?: ToastOptions): void => {
    const tone = options?.tone ?? "info";
    const duration = options?.duration ?? (tone === "warning" || tone === "error" ? 6000 : 4000);
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-60 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 print:hidden"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-3 text-sm font-medium shadow-lg",
              toastToneClass(t.tone),
            )}
          >
            {t.message}
          </div>
        ))}
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
