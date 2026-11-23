// src/app/admin/(shell)/sign-ins/page.tsx
// Sign-ins page: which devices are signed in to admin and where from, plus every recent sign-in
// attempt, right or wrong. Rows come from the sign-in log (sign-in-log.server.ts).

import { SignOutSessionButton } from "@/features/admin/components/SignInSessionActions";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import {
  TABLE_CLS,
  TABLE_SCROLL_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { deviceLabel } from "@/features/admin/lib/device-label";
import { ADMIN_SESSION_COOKIE, readSessionId } from "@/shared/lib/admin-session";
import { requireAdminAuth } from "@/shared/lib/auth";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign-ins - Admin",
  robots: { index: false, follow: false },
};

/** How many attempts the history shows. */
const ATTEMPT_LIMIT = 100;

/**
 * "Auckland, AUK, NZ" from whichever geo parts were recorded.
 * @param row - Log row.
 * @param row.city - City.
 * @param row.region - Region code.
 * @param row.country - Country code.
 * @returns Place, or "Unknown" (always the case on localhost).
 */
function placeOf(row: {
  city: string | null;
  region: string | null;
  country: string | null;
}): string {
  const parts = [row.city, row.region, row.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown";
}

/**
 * Pill label and tone for an attempt's outcome.
 * @param outcome - Stored outcome.
 * @returns Label and tone.
 */
function outcomePill(outcome: string): { label: string; tone: StatusTone } {
  if (outcome === "ok") return { label: "Signed in", tone: "success" };
  if (outcome === "wrong") return { label: "Wrong secret", tone: "critical" };
  return { label: "Bad request", tone: "warning" };
}

/**
 * Admin Sign-ins page.
 * @returns Sign-ins page element.
 */
export default async function SignInsPage(): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/sign-ins");

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [store, sessions, attempts, failedToday] = await Promise.all([
    cookies(),
    prisma.adminSignIn.findMany({
      where: { outcome: "ok", signedOutAt: null, expiresAt: { gt: now } },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.adminSignIn.findMany({ orderBy: { at: "desc" }, take: ATTEMPT_LIMIT }),
    prisma.adminSignIn.count({ where: { outcome: { not: "ok" }, at: { gte: dayAgo } } }),
  ]);
  const currentId = readSessionId(store.get(ADMIN_SESSION_COOKIE)?.value);

  return (
    <>
      <PageHeader
        title="Sign-ins"
        description="Every attempt at the admin sign-in, and the devices signed in now. Places come from the IP address, so they're only roughly right."
      />
      <div className="space-y-6">
        <Card padding="none">
          <CardHeader
            title="Signed in now"
            description="Devices signed in before this log started aren't listed, but Sign out all other devices ends them too."
            actions={<SignOutSessionButton target="others" />}
          />
          {sessions.length === 0 ? (
            <EmptyState
              title="No sessions logged yet"
              body="Sessions show here from their next sign-in."
            />
          ) : (
            <ul className="divide-y divide-admin-border">
              {sessions.map((s) => {
                const isCurrent = s.sessionId !== null && s.sessionId === currentId;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="font-semibold text-admin-text">
                      {deviceLabel(s.userAgent)}
                    </span>
                    {isCurrent && <StatusPill tone="info">This device</StatusPill>}
                    <span className="text-admin-muted">
                      {placeOf(s)} · {s.ip}
                    </span>
                    <span className="text-sm text-admin-muted sm:ml-auto">
                      Signed in {formatDateTimeShort(s.at)}
                      {s.lastSeenAt && <> · last seen {formatDateTimeShort(s.lastSeenAt)}</>}
                    </span>
                    {!isCurrent && (
                      <SignOutSessionButton target={s.id} device={deviceLabel(s.userAgent)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card padding="none">
          <CardHeader
            title="Attempts"
            description={`Last ${ATTEMPT_LIMIT}, kept 180 days. ${failedToday} failed in the last 24 hours.`}
          />
          {attempts.length === 0 ? (
            <EmptyState title="No sign-in attempts yet" />
          ) : (
            <div className={TABLE_SCROLL_CLS}>
              <table className={TABLE_CLS}>
                <thead className={THEAD_CLS}>
                  <tr>
                    <th className={TH_CLS}>When</th>
                    <th className={TH_CLS}>Result</th>
                    <th className={TH_CLS}>Device</th>
                    <th className={TH_CLS}>Place</th>
                    <th className={TH_CLS}>IP</th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLS}>
                  {attempts.map((a) => {
                    const pill = outcomePill(a.outcome);
                    return (
                      <tr key={a.id}>
                        <td className={`${TD_CLS} whitespace-nowrap`}>
                          {formatDateTimeShort(a.at)}
                        </td>
                        <td className={TD_CLS}>
                          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                        </td>
                        <td className={TD_CLS} title={a.userAgent ?? undefined}>
                          {deviceLabel(a.userAgent)}
                        </td>
                        <td className={TD_CLS}>{placeOf(a)}</td>
                        <td className={`${TD_CLS} font-mono text-sm`}>{a.ip}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
