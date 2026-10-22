// src/features/social/components/SocialConnections.tsx
// The Overview's Linked accounts card: whether each app's keys still work, the account they
// reach or why they don't, and a button to check again.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { AppIcons } from "@/features/social/components/AppIcons";
import type { Connection } from "@/features/social/lib/post-display";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import type React from "react";

/** Anchor the set-up list's Connect step links to. */
export const LINKED_ACCOUNTS_ID = "linked-accounts";

/**
 * Linked accounts card.
 * @param props - Component props.
 * @param props.connections - Result of the last check, or null before it answers.
 * @param props.error - Why the check on opening the page couldn't run.
 * @param props.checking - Whether Check again is running.
 * @param props.onCheck - Checks every app again.
 * @returns Card element.
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
    <section id={LINKED_ACCOUNTS_ID} aria-label="Linked accounts" className="scroll-mt-24">
      <Card>
        <CardHeader
          title="Linked accounts"
          description="Whether each app's keys still work. Checked every 10 minutes at most."
          actions={
            <AdminButton size="xs" variant="secondary" busy={checking} onClick={onCheck}>
              Check again
            </AdminButton>
          }
        />
        {error && connections === null && (
          <p className="mb-3 text-sm text-admin-text-secondary">Couldn&apos;t check: {error}</p>
        )}
        <ul className="flex flex-col gap-3">
          {SOCIAL_PLATFORMS.map((platform) => {
            const c = connections?.find((x) => x.platform === platform);
            return (
              <li key={platform} className="flex items-start gap-3">
                <AppIcons platforms={[platform]} className="mt-0.5 [&_svg]:size-5" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-admin-text">{PLATFORM_LABEL[platform]}</p>
                  <p className="text-sm wrap-break-word text-admin-muted">
                    {!c ? (error ? "Not checked" : "Checking...") : c.ok ? c.label : c.error}
                  </p>
                </div>
                {c && (
                  <StatusPill tone={c.ok ? "success" : "critical"}>
                    {c.ok ? "Connected" : "Not connected"}
                  </StatusPill>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
