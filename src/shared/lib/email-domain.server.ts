// src/shared/lib/email-domain.server.ts
// Whether an email address's domain can receive mail at all, asked of DNS. The format
// check passes "bgp@bgp.bgp"; only a lookup shows that domain doesn't exist.

import { promises as dns } from "node:dns";

/** "unknown" means DNS couldn't answer; callers let the address through. */
export type EmailDomainResult = "ok" | "no-mail" | "unknown";

/** The DNS calls {@link checkEmailDomain} makes; swapped for a stub in the checks. */
export interface EmailDomainResolver {
  resolveMx: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolve4: (domain: string) => Promise<string[]>;
  resolve6: (domain: string) => Promise<string[]>;
}

// Short timeout and two tries: the lookup sits in front of a booking, and a slow
// answer is treated as unknown rather than holding the customer up.
const defaultResolver: EmailDomainResolver = new dns.Resolver({ timeout: 1500, tries: 2 });

/** Codes that mean DNS answered "nothing there", not "couldn't ask". */
const NOTHING_THERE = new Set(["ENOTFOUND", "ENODATA"]);

/**
 * Runs one lookup and folds its outcome into records, "none" or "error".
 * @param lookup - The DNS call.
 * @returns The records, "none" when DNS says there are none, or "error".
 */
async function records<T>(lookup: () => Promise<T[]>): Promise<T[] | "none" | "error"> {
  try {
    const found = await lookup();
    return found.length > 0 ? found : "none";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code && NOTHING_THERE.has(code) ? "none" : "error";
  }
}

/**
 * Checks a format-valid address's domain can take mail: MX ok unless only the RFC 7505 null
 * MX; no MX falls back to A/AAAA (RFC 5321 5.1); neither or NXDOMAIN is no-mail. DNS failures
 * are unknown, so a hiccup never blocks a booking.
 * @param email - Email address that has passed the format check.
 * @param resolver - DNS calls, for the checks.
 * @returns Whether the domain can receive mail.
 */
export async function checkEmailDomain(
  email: string,
  resolver: EmailDomainResolver = defaultResolver,
): Promise<EmailDomainResult> {
  const domain = email
    .slice(email.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!domain) return "no-mail";

  const mx = await records(() => resolver.resolveMx(domain));
  if (mx === "error") return "unknown";
  if (mx !== "none") {
    const nullMx = mx.length === 1 && mx[0]?.exchange.replace(/\.$/, "") === "";
    return nullMx ? "no-mail" : "ok";
  }

  const [v4, v6] = await Promise.all([
    records(() => resolver.resolve4(domain)),
    records(() => resolver.resolve6(domain)),
  ]);
  if (Array.isArray(v4) || Array.isArray(v6)) return "ok";
  if (v4 === "error" || v6 === "error") return "unknown";
  return "no-mail";
}
