"use client";
// src/features/social/components/SocialPermissions.tsx
// The Overview's What each app can do card: a row per feature with each app's state, the Meta
// token's type and dates, and the steps to make a Meta token that doesn't run out.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { AppIcons } from "@/features/social/components/AppIcons";
import {
  FEATURES,
  featureStatus,
  type CellStatus,
  type Permissions,
} from "@/features/social/lib/permissions";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { FaCircleCheck, FaCircleExclamation, FaCircleXmark } from "react-icons/fa6";

/** Anchor the set-up list's permissions step and the token warning link to. */
export const APP_PERMISSIONS_ID = "app-permissions";

/** Every Meta permission any feature needs, for the token steps. */
const ALL_SCOPES = [
  ...new Set(
    FEATURES.flatMap((f) =>
      Object.values(f.needs).flatMap((n) => (n && "scopes" in n ? n.scopes : [])),
    ),
  ),
];

const GRID_COLS = "md:grid-cols-[minmax(10rem,1.2fr)_repeat(3,minmax(0,1fr))]";

/**
 * What each app can do card.
 * @param props - Component props.
 * @param props.permissions - The last check, or null before it answers.
 * @param props.error - Why the check on opening the page couldn't run.
 * @returns Card element.
 */
export function SocialPermissions({
  permissions,
  error,
}: {
  permissions: Permissions | null;
  error: string | null;
}): React.ReactElement {
  return (
    <section id={APP_PERMISSIONS_ID} aria-label="What each app can do" className="scroll-mt-24">
      <Card>
        <CardHeader
          title="What each app can do"
          description="Facebook and Instagram go by the Meta token's permissions. Google goes by whether each of its APIs answers."
        />
        {error && permissions === null && (
          <p className="mb-3 text-sm text-admin-text-secondary">Couldn&apos;t check: {error}</p>
        )}
        {permissions && <TokenLine permissions={permissions} />}

        <div
          aria-hidden
          className={`hidden gap-x-4 border-b border-admin-border pb-2 text-sm font-semibold text-admin-muted md:grid ${GRID_COLS}`}
        >
          <span>Feature</span>
          {SOCIAL_PLATFORMS.map((p) => (
            <span key={p} className="flex items-center gap-2">
              <AppIcons platforms={[p]} />
              {PLATFORM_LABEL[p]}
            </span>
          ))}
        </div>
        <ul>
          {FEATURES.map((f) => {
            const statuses = featureStatus(f.key, permissions);
            return (
              <li
                key={f.key}
                className={`grid gap-2 border-b border-admin-border py-3 last:border-b-0 md:gap-x-4 ${GRID_COLS}`}
              >
                <div>
                  <p className="font-semibold text-admin-text">{f.label}</p>
                  <p className="text-sm text-admin-muted">{f.detail}</p>
                </div>
                {SOCIAL_PLATFORMS.map((p) => (
                  <Cell key={p} platform={p} status={statuses[p]} />
                ))}
              </li>
            );
          })}
        </ul>

        <details className="mt-4 rounded-md border border-admin-border p-3">
          <summary className="cursor-pointer font-semibold text-admin-text">
            Make a Meta token that doesn&apos;t run out
          </summary>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-base text-admin-text">
            <li>
              In Meta Business Suite, open Settings, then Users, then System users, and add one with
              the Admin role.
            </li>
            <li>Assign it your Page and your Instagram account, with full control.</li>
            <li>
              Generate a token for your app, set to never expire, with these permissions:{" "}
              <span className="text-sm break-all text-admin-text-secondary">
                {ALL_SCOPES.join(", ")}
              </span>
              .
            </li>
            <li>
              Swap it for the Page&apos;s own token: in the Graph API Explorer, using the new token,
              ask for{" "}
              <span className="font-mono text-sm">{"<your Page id>?fields=access_token"}</span>.
            </li>
            <li>
              Put that token in META_PAGE_ACCESS_TOKEN on Vercel and in .env.local, redeploy, then
              press Check again.
            </li>
          </ol>
          <p className="mt-3 text-sm text-admin-muted">
            Comments from people outside your app and messages can also need Meta&apos;s App Review
            and the app in Live mode.
          </p>
        </details>
      </Card>
    </section>
  );
}

/**
 * The Meta token's type and dates.
 * @param props - Component props.
 * @param props.permissions - The last check.
 * @returns Paragraph, or null when there's nothing to say.
 */
function TokenLine({ permissions }: { permissions: Permissions }): React.ReactElement | null {
  const { token, tokenError } = permissions;
  if (!token) {
    if (!tokenError) return null;
    return (
      <p className="mb-3 text-sm text-admin-text-secondary">
        Couldn&apos;t read the Meta token: {tokenError}
      </p>
    );
  }
  const kind = token.type ? `${token.type.toLowerCase().replace("_", " ")} token` : "token";
  const runs = token.expiresAt
    ? `It runs out on ${formatDateShort(token.expiresAt)}`
    : "It doesn't run out";
  const data = token.dataAccessExpiresAt
    ? `Meta lets it read your Page until ${formatDateShort(token.dataAccessExpiresAt)}.`
    : "Its data access doesn't run out either.";
  return (
    <p className="mb-3 text-sm text-admin-text-secondary">
      {token.valid
        ? `The Meta token is a ${kind}${token.app ? ` for ${token.app}` : ""}. ${runs}. ${data}`
        : `The Meta token has stopped working${token.error ? `: ${token.error}` : "."}`}
    </p>
  );
}

/**
 * One app's state for one feature.
 * @param props - Component props.
 * @param props.platform - The app.
 * @param props.status - Its state.
 * @returns Cell element.
 */
function Cell({
  platform,
  status,
}: {
  platform: SocialPlatformKey;
  status: CellStatus;
}): React.ReactElement {
  // The app's name shows on phones, where there's no header row, and is always read out.
  const name = <span className="font-semibold md:sr-only">{PLATFORM_LABEL[platform]}: </span>;
  if (status.state === "ready") {
    return (
      <p className="flex items-start gap-2 text-sm text-admin-text">
        <FaCircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-moonstone-600" />
        <span>
          {name}
          Ready
        </span>
      </p>
    );
  }
  if (status.state === "missing") {
    return (
      <p className="flex items-start gap-2 text-sm text-admin-text">
        <FaCircleExclamation aria-hidden className="mt-0.5 size-4 shrink-0 text-coquelicot-700" />
        <span className="min-w-0">
          {name}
          Needs
          {status.missing.map((s, i) => (
            <span key={s} className="block wrap-anywhere">
              {s}
              {i < status.missing.length - 1 ? "," : ""}
            </span>
          ))}
        </span>
      </p>
    );
  }
  if (status.state === "off") {
    return (
      <p className="flex items-start gap-2 text-sm text-admin-text-secondary">
        <FaCircleXmark aria-hidden className="mt-0.5 size-4 shrink-0 text-admin-muted" />
        <span className="min-w-0 wrap-break-word">
          {name}
          {status.reason}
        </span>
      </p>
    );
  }
  return (
    <p className="text-sm text-admin-muted">
      {name}
      {status.state === "checking" ? "Checking..." : "Not offered"}
    </p>
  );
}
