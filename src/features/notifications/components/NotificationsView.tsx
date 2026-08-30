"use client";
// src/features/notifications/components/NotificationsView.tsx
/**
 * @description Per-device push notification setup. Resolves the browser into
 * one of five states and shows only the controls that can actually work there.
 *
 * iOS is the reason this is stateful rather than a single button: Apple only
 * allows push for home-screen web apps, and a declined permission prompt can
 * only be undone in iOS Settings, never re-prompted from the page.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

/** A registered device as returned by /api/admin/push/devices. */
interface PushDeviceRow {
  id: string;
  endpoint: string;
  label: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Which controls the current browser can meaningfully show. */
type PushState = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

/**
 * Converts a base64url VAPID key into the Uint8Array the Push API requires.
 * @param base64String - base64url-encoded application server key.
 * @returns The decoded key bytes.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  // Back the array with an explicit ArrayBuffer: applicationServerKey takes a
  // BufferSource, and a bare `new Uint8Array(n)` widens to ArrayBufferLike,
  // which includes SharedArrayBuffer and so does not satisfy it.
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Names the current browser so the device list is readable at a glance.
 * @returns A short device label.
 */
function describeThisDevice(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Firefox/.test(ua)) return "Desktop Firefox";
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "Desktop Safari";
  return "Desktop browser";
}

/** Shared card shell so every state reads as the same surface. */
const CARD_CLS = "space-y-3 rounded-xl border border-admin-border bg-admin-surface p-5 shadow-sm";

/**
 * Push notification setup and device management for the current browser.
 * @returns Notifications view element.
 */
export function NotificationsView(): React.ReactElement {
  const { toast } = useToast();
  const [state, setState] = useState<PushState>("loading");
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [busy, setBusy] = useState(false);

  const loadDevices = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/admin/push/devices");
      const d = (await res.json()) as { ok: boolean; devices?: PushDeviceRow[] };
      if (d.ok && d.devices) setDevices(d.devices);
    } catch {
      toast("Couldn't load registered devices.", { tone: "error" });
    }
  }, [toast]);

  // Resolve which of the five states this browser is in. Every branch is
  // reachable on iOS, and showing the wrong one means an Enable button that
  // silently does nothing.
  useEffect(() => {
    /**
     * Works out which of the five states this browser is in and stores it.
     * @returns Promise that resolves once the state has been set.
     */
    async function resolve(): Promise<void> {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }

      // iOS only allows push for home-screen web apps, so an uninstalled
      // iPhone gets install steps rather than a button that cannot work.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
      if (isIOS && !isStandalone) {
        setState("needs-install");
        return;
      }

      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "on" : "off");
      if (existing) await loadDevices();
    }

    void resolve();
  }, [loadDevices]);

  /** Subscribes this browser and registers it server-side. */
  async function enable(): Promise<void> {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""),
      });

      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/admin/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          label: describeThisDevice(),
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error("register failed");

      setState("on");
      await loadDevices();
      toast("Notifications enabled on this device.", { tone: "success" });
    } catch {
      // A declined prompt lands here too, and on iOS it cannot be re-asked.
      setState(Notification.permission === "denied" ? "blocked" : "off");
      toast("Couldn't enable notifications on this device.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  /** Unsubscribes this browser and removes it server-side. */
  async function disable(): Promise<void> {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/admin/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      await loadDevices();
      toast("Notifications turned off on this device.", { tone: "success" });
    } catch {
      toast("Couldn't turn notifications off.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  /** Sends a test notification to every registered device. */
  async function sendTest(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/push/test", { method: "POST" });
      if (!res.ok) throw new Error("test failed");
      toast("Test sent - it should appear shortly.", { tone: "success" });
    } catch {
      toast("Couldn't send the test notification.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Removes a device by endpoint.
   * @param endpoint - The device's push endpoint.
   */
  async function removeDevice(endpoint: string): Promise<void> {
    try {
      await fetch("/api/admin/push/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      await loadDevices();
      toast("Device removed.", { tone: "success" });
    } catch {
      toast("Couldn't remove that device.", { tone: "error" });
    }
  }

  if (state === "loading") {
    return <p className="text-sm text-admin-muted">Checking this device…</p>;
  }

  if (state === "unsupported") {
    return (
      <div className={CARD_CLS}>
        <h2 className="font-semibold text-russian-violet">Not supported here</h2>
        <p className="text-admin-muted">
          This browser can&apos;t receive push notifications. Booking and review emails still arrive
          as normal.
        </p>
      </div>
    );
  }

  if (state === "needs-install") {
    return (
      <div className={CARD_CLS}>
        <h2 className="font-semibold text-russian-violet">Add this to your Home Screen first</h2>
        <p className="text-admin-muted">
          On iPhone, notifications only work once the admin is installed to the Home Screen. Safari
          tabs can&apos;t receive them.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-admin-text">
          <li>Tap the Share button in Safari</li>
          <li>Choose &quot;Add to Home Screen&quot;</li>
          <li>Open the admin from the new Home Screen icon</li>
          <li>Sign in again - the installed app has its own login</li>
          <li>Come back to this page and turn notifications on</li>
        </ol>
      </div>
    );
  }

  if (state === "blocked") {
    return (
      <div className={CARD_CLS}>
        <h2 className="font-semibold text-russian-violet">Notifications are blocked</h2>
        <p className="text-admin-muted">
          This device declined the prompt, and it can&apos;t be asked again from the page. On
          iPhone, turn it back on in Settings &gt; Notifications &gt; To the Point Admin, then
          reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={CARD_CLS}>
        <h2 className="font-semibold text-russian-violet">This device</h2>
        {state === "on" ? (
          <>
            <p className="text-admin-muted">Notifications are on for this device.</p>
            <div className="flex flex-wrap gap-2">
              <AdminButton onClick={() => void sendTest()} busy={busy}>
                Send test notification
              </AdminButton>
              <AdminButton variant="secondary" onClick={() => void disable()} disabled={busy}>
                Turn off
              </AdminButton>
            </div>
          </>
        ) : (
          <>
            <p className="text-admin-muted">
              Get a notification when a booking arrives, changes, or a review comes in.
            </p>
            <AdminButton onClick={() => void enable()} busy={busy}>
              Enable on this device
            </AdminButton>
          </>
        )}
      </div>

      {devices.length > 0 && (
        <div className={CARD_CLS}>
          <h2 className="font-semibold text-russian-violet">Registered devices</h2>
          <ul className="divide-y divide-admin-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-admin-text">{d.label ?? "Unnamed device"}</p>
                  <p className="text-sm text-admin-muted" suppressHydrationWarning>
                    {d.lastSeenAt
                      ? `Last notified ${new Date(d.lastSeenAt).toLocaleString("en-NZ")}`
                      : "Not notified yet"}
                  </p>
                </div>
                <AdminButton
                  variant="secondary"
                  size="xs"
                  onClick={() => void removeDevice(d.endpoint)}
                >
                  Remove
                </AdminButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
