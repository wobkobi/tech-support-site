"use client";
// src/features/social/hooks/use-inbox-unread.ts
// The inbox's unread count for the sidebar. The admin layout doesn't re-render on client
// navigation, so the count is read again on every page change and whenever the inbox says so.

import { callApi } from "@/features/mailing/lib/api-client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Window event the inbox fires after anything that can change the unread count. */
const INBOX_UNREAD_EVENT = "inbox-unread";

/** Tells the sidebar to read the unread count again. */
export function announceInboxChange(): void {
  window.dispatchEvent(new Event(INBOX_UNREAD_EVENT));
}

/**
 * Unread inbox threads, read on mount, on each page change and on {@link announceInboxChange}.
 * @returns The count; 0 until the first read lands or when it fails.
 */
export function useInboxUnread(): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    /** Reads the count, dropping a reply that lands after the page moved on. */
    async function read(): Promise<void> {
      const res = await callApi<{ count: number }>("/api/admin/social/inbox/unread");
      if (live && res.ok) setCount(res.count);
    }
    /** Reads again when another part of the page changes the inbox. */
    const onChange = (): void => {
      void read();
    };
    void read();
    window.addEventListener(INBOX_UNREAD_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(INBOX_UNREAD_EVENT, onChange);
    };
  }, [pathname]);

  return count;
}
