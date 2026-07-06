// scripts/seed-settings.ts
/**
 * @description One-shot, idempotent seed for the env > DB business-identity
 * handoff. Creates the `settings:identity` row from the code defaults - which
 * read the current bank-account / GST# / HOME_ADDRESS env vars - ONLY when the
 * row doesn't already exist, so it never clobbers operator edits made in the
 * admin panel. After running this against production and verifying the row, the
 * `NEXT_PUBLIC_BUSINESS_*` and `HOME_ADDRESS` Vercel env vars can be deleted;
 * the DB row is then the single source of truth.
 *
 * Only `identity` is seeded: every other settings group intentionally stays
 * absent so it keeps tracking the code defaults until the operator edits it.
 *
 * Run with: npm run settings:seed   (dotenv-cli loads .env.local first)
 */

import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS } from "../src/shared/lib/settings/defaults";

// Mirrors SETTINGS_KEY_PREFIX in src/shared/lib/settings/get-settings.ts. Not
// imported: that module pulls in next/cache, which can't run outside Next.
const SETTINGS_KEY_PREFIX = "settings:";

const db = new PrismaClient();

/**
 * Seeds `settings:identity` from the env-derived defaults when it's absent.
 * @returns Resolves once the row is created (or the existing one is left alone).
 */
async function main(): Promise<void> {
  const key = `${SETTINGS_KEY_PREFIX}identity`;
  const existing = await db.setting.findUnique({ where: { key } });
  if (existing) {
    console.log(`[seed-settings] ${key} already exists - leaving operator data untouched.`);
    return;
  }

  const { identity } = DEFAULT_SETTINGS;
  // Bare create with no SettingAudit row: this one-shot seed intentionally
  // stays out of the audit trail (it records the env-derived starting point,
  // not an operator edit). saveSettingsGroup - which does audit - can't be
  // imported here because it pulls in next/cache.
  await db.setting.create({ data: { key, value: JSON.stringify(identity) } });

  console.log(`[seed-settings] Created ${key} from the current env defaults:`);
  console.log(`  bankAccount: ${identity.bankAccount}`);
  console.log(`  gstNumber:   ${identity.gstNumber || "(none set)"}`);
  console.log(`  baseAddress: ${identity.baseAddress.line || "(HOME_ADDRESS not set)"}`);
  console.log(
    "[seed-settings] Verify the row, then retire NEXT_PUBLIC_BUSINESS_* / HOME_ADDRESS in Vercel.",
  );
}

main()
  .catch((err) => {
    console.error("[seed-settings] Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
