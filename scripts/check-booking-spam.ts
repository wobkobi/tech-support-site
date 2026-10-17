// scripts/check-booking-spam.ts
// The checks that stop a junk public booking: a phone number that can't be dialled,
// a description with no words in it, and an email domain that can't take mail. The
// fixtures include the fields of a real junk booking alongside real formats that
// must keep passing.
// Run with: npm test -- booking-spam

import { checkDescription, validateBookingPayloadFields } from "@/features/booking/lib/booking";
import { checkEmailDomain, type EmailDomainResolver } from "@/shared/lib/email-domain.server";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { expectEqual, finish } from "./lib/harness.js";

/**
 * A DNS error carrying a Node-style code.
 * @param code - The error code, e.g. ENOTFOUND.
 * @returns The error.
 */
function dnsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/**
 * Stub resolver answering from a fixed table. A domain missing from a table
 * answers ENOTFOUND; a value of "timeout" answers ETIMEOUT.
 * @param mx - Domain > MX hosts.
 * @param a - Domain > A records.
 * @returns The resolver.
 */
function stubResolver(
  mx: Record<string, string[] | "timeout">,
  a: Record<string, string[]> = {},
): EmailDomainResolver {
  return {
    /**
     * MX hosts from the table.
     * @param domain - Domain looked up.
     * @returns The hosts as MX records.
     */
    resolveMx: async (domain) => {
      const hosts = mx[domain];
      if (hosts === "timeout") throw dnsError("ETIMEOUT");
      if (!hosts) throw dnsError("ENOTFOUND");
      return hosts.map((exchange, priority) => ({ exchange, priority }));
    },
    /**
     * A records from the table.
     * @param domain - Domain looked up.
     * @returns The addresses.
     */
    resolve4: async (domain) => {
      if (!a[domain]) throw dnsError("ENOTFOUND");
      return a[domain];
    },
    /**
     * No fixture has AAAA records.
     * @returns Never; always answers ENODATA.
     */
    resolve6: async () => {
      throw dnsError("ENODATA");
    },
  };
}

console.log("validatePhone");
for (const [raw, result, e164] of [
  // The junk booking: no 0, no +, so there is no country to dial it in.
  ["123123123", "invalid", ""],
  ["1234567", "invalid", ""],
  ["+64 123 123 123", "invalid", ""],
  ["021 123 4567", "ok", "+64211234567"],
  ["021345345", "ok", "+6421345345"],
  ["022 306 9079", "ok", "+64223069079"],
  ["027 123 45678", "ok", "+642712345678"],
  ["21 123 4567", "ok", "+64211234567"],
  ["21 1234 5678", "ok", "+642112345678"],
  ["9 123 4567", "ok", "+6491234567"],
  ["64 21 123 4567", "ok", "+64211234567"],
  ["0064 21 123 4567", "ok", "+64211234567"],
  ["+64 (0)21 123 4567", "ok", "+64211234567"],
  // No area code: 09 or 03 can't be told apart.
  ["123 4567", "invalid", ""],
  ["09 267 8181", "ok", "+6492678181"],
  ["03 123 4567", "ok", "+6431234567"],
  ["0800 123 456", "ok", "+64800123456"],
  ["+64 21 123 4567", "ok", "+64211234567"],
  // The trunk 0 kept after the country code is dropped, not rejected.
  ["+64 021 123 4567", "ok", "+64211234567"],
  ["+61 400 000 000", "ok", "+61400000000"],
  ["+1 415 555 0100", "ok", "+14155550100"],
  ["", "empty", ""],
  ["abc", "invalid", ""],
] as const) {
  expectEqual(`"${raw}"`, validatePhone(raw), { result, e164 });
}

console.log("validatePhone nzOnly (public forms)");
for (const [raw, result] of [
  ["021 123 4567", "ok"],
  ["+64 21 123 4567", "ok"],
  ["+61 400 000 000", "invalid"],
  ["+1 415 555 0100", "invalid"],
] as const) {
  expectEqual(`"${raw}"`, validatePhone(raw, { nzOnly: true }).result, result);
}

console.log("checkDescription");
for (const [raw, expected] of [
  ["123123123123", "no-words"],
  ["asdasdasdasd", "no-words"],
  ["aaaaaaaaaaaa", "no-words"],
  ["ab ab ab ab ab", "no-words"],
  ["!!!!!!!!!!!!", "no-words"],
  ["0211234567 x", "no-words"],
  ["short", "too-short"],
  ["   ", "empty"],
  ["PC is slow!", "ok"],
  ["printer won't connect to the wifi", "ok"],
  ["Wi-Fi drops out", "ok"],
] as const) {
  expectEqual(`"${raw}"`, checkDescription(raw), expected);
}

console.log("validateBookingPayloadFields");
const base = {
  name: "Jane Smith",
  email: "jane@example.co.nz",
  notes: "Laptop won't turn on",
  dateKey: "2026-10-20",
  timeOfDay: "10am",
  duration: "short",
  meetingType: "remote",
} as const;
expectEqual("real booking", validateBookingPayloadFields(base, { requireEmail: true }), {
  valid: true,
});
expectEqual(
  "digits-only notes",
  validateBookingPayloadFields({ ...base, notes: "123123123123" }, { requireEmail: true }).valid,
  false,
);
expectEqual(
  "digits-only name",
  validateBookingPayloadFields({ ...base, name: "12345" }, { requireEmail: true }).valid,
  false,
);

console.log("checkEmailDomain");
const resolver = stubResolver(
  {
    "gmail.com": ["gmail-smtp-in.l.google.com"],
    "xtra.co.nz": ["mx.xtra.co.nz"],
    "nomail.example": [""],
    "slow.example": "timeout",
  },
  { "aonly.example": ["203.0.113.5"] },
);
for (const [email, expected] of [
  ["jane@gmail.com", "ok"],
  ["Jane@XTRA.co.nz", "ok"],
  // The junk booking's domain doesn't exist.
  ["bgp@bgp.bgp", "no-mail"],
  ["someone@nomail.example", "no-mail"],
  ["someone@aonly.example", "ok"],
  ["someone@slow.example", "unknown"],
] as const) {
  expectEqual(email, await checkEmailDomain(email, resolver), expected);
}

finish();
