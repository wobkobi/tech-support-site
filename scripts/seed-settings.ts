// scripts/seed-settings.ts
// One-shot idempotent seed of `settings:identity` from the env-backed code defaults, only
// when the row is missing. Other groups stay absent so they track code defaults.
// Run with: npm run settings:seed   (dotenv-cli loads .env.local first)

import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS } from "../src/shared/lib/settings/defaults";

// Mirrors SETTINGS_KEY_PREFIX in get-settings.ts, which can't be imported outside Next.
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
  // No SettingAudit row: this is the starting point, not an operator edit.
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
