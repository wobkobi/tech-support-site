// src/features/business/components/calculator/ReissueBanner.tsx
// Banner shown while the calculator rebuilds a voided invoice: names the invoice, says
// the promo is priced again, and that any amount paid on the day stays on the voided one.

import { formatNZD } from "@/features/business/lib/business-format";
import type { ReissuePrefill } from "@/features/business/lib/invoice-reissue";
import { Notice } from "@/shared/components/Notice";
import type React from "react";

/**
 * "Re-issuing" banner, above the calculator grid like the draft banner.
 * @param props - Component props.
 * @param props.reissue - What was carried over from the voided invoice.
 * @param props.fromEvent - Whether a calendar event filled in the times and client.
 * @returns Banner element.
 */
export function ReissueBanner({
  reissue,
  fromEvent,
}: {
  reissue: ReissuePrefill;
  fromEvent: boolean;
}): React.ReactElement {
  return (
    <Notice onGrey className="mb-4">
      Re-issuing {reissue.invoiceNumber}. Its lines are in &quot;Describe the job&quot; to parse or
      rebuild, and the promo is worked out again for the job date.
      {!fromEvent &&
        " It wasn't made from a calendar event, so check the job date and set the times by hand."}
      {reissue.alreadyPaid !== null &&
        ` The ${formatNZD(reissue.alreadyPaid)} paid on the day stays on ${reissue.invoiceNumber}, so don't add it again here.`}
    </Notice>
  );
}
