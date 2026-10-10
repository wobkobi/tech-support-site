"use client";
// src/features/social/components/SocialConnections.tsx
// Connection strip at the foot of the Social page: whether each platform's credentials
// still work, why not when they don't, and a button to check again.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import type { Connection } from "@/features/social/lib/post-display";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import type React from "react";

/**
 * Connections strip.
 * @param props - Component props.
 * @param props.connections - Result of the last check, or null before it answers.
 * @param props.error - Why the check on opening the page couldn't run.
 * @param props.checking - Whether the Check button's request is running.
 * @param props.onCheck - Checks every platform again.
 * @returns Strip element.
 */
export function SocialConnections({
  connections,
  error,
  checking,
  onCheck,
}: {
  connections: Connection[] | null;
  error: string | null;
  checking: boolean;
  onCheck: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-admin-text">Connections</span>
        {connections === null ? (
          <span className="text-admin-muted">
            {error ? `Couldn't check: ${error}` : "Checking..."}
          </span>
        ) : (
          connections.map((c) => (
            <span key={c.platform} title={c.ok ? c.label : c.error}>
              <StatusPill tone={c.ok ? "success" : "critical"}>
                {PLATFORM_LABEL[c.platform]}
                {c.ok ? `: ${c.label}` : ": not connected"}
              </StatusPill>
            </span>
          ))
        )}
        <AdminButton size="xs" variant="secondary" busy={checking} onClick={onCheck}>
          Check
        </AdminButton>
      </div>
      {connections?.some((c) => !c.ok) && (
        <ul className="list-disc pl-5 text-sm text-admin-text-secondary">
          {connections
            .filter((c) => !c.ok)
            .map((c) => (
              <li key={c.platform}>
                {PLATFORM_LABEL[c.platform]}: {c.error}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
