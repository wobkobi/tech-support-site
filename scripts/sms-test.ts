// scripts/sms-test.ts
/**
 * @file sms-test.ts
 * @description One-off test send for the ClickSend SMS path. Bypasses the
 * booking cron entirely - just fires the same reminder body sendBookingReminderSms
 * would build, to a phone number passed on the CLI. Useful for confirming the
 * ClickSend account, alpha sender, and env vars work end-to-end.
 *
 * Usage:
 *   npm run sms:test "+64211234567"
 *   npm run sms:test "+64211234567" "Sarah"
 *
 * Exits 0 on accepted send, 1 on any failure or misconfig.
 */

import { sendBookingReminderSms } from "../src/features/booking/lib/sms";

/**
 * Sends one test ClickSend reminder SMS to the phone number passed as the
 * first CLI arg. Exits 0 on accepted send, 1 on any failure or misconfig.
 * @returns Resolves after the send attempt completes.
 */
async function main(): Promise<void> {
  const [, , phoneArg, nameArg] = process.argv;
  if (!phoneArg) {
    console.error('Usage: npm run sms:test "+64211234567" [name]');
    process.exit(1);
  }

  const phone = phoneArg.trim();
  const name = nameArg?.trim() || "Harrison";

  // Fake "appointment today at 3pm" so the reminder body looks realistic.
  const startAt = new Date();
  startAt.setHours(15, 0, 0, 0);

  console.log(`[sms:test] sending to ${phone} (name=${name}, startAt=${startAt.toISOString()})`);
  const ok = await sendBookingReminderSms({ name, phone, startAt });

  if (ok) {
    console.log("[sms:test] ClickSend accepted the message");
    process.exit(0);
  } else {
    console.error("[sms:test] send failed - check the logs above");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[sms:test] unexpected error:", err);
  process.exit(1);
});
