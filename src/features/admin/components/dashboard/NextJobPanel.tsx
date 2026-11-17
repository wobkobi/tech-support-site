// src/features/admin/components/dashboard/NextJobPanel.tsx
// Dashboard panel for the next job, booked or calendar-only: who, when and where, with
// Call, Maps and Open as large one-tap buttons. First thing on a phone, top of the side
// column on desktop.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import type { DashboardJob } from "@/features/admin/lib/dashboard-jobs";
import { mapsSearchUrl } from "@/features/booking/lib/booking";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";
import { FaArrowRight, FaLocationDot, FaPhone } from "react-icons/fa6";

/** Taller than the standard button: these get tapped on the move. */
const BIG_BUTTON_CLS = "h-12 w-full text-base";

/**
 * Next job panel. Shows the empty state when nothing is coming up.
 * @param props - Component props.
 * @param props.nextJob - The soonest job still to start, if any.
 * @param props.className - Extra classes for the panel.
 * @returns The panel element.
 */
export function NextJobPanel({
  nextJob,
  className,
}: {
  nextJob: DashboardJob | undefined;
  className?: string;
}): React.ReactElement {
  const where = nextJob?.address ?? (nextJob?.remote ? "Remote" : null);
  return (
    <DashboardPanel title="Next job" empty="No upcoming jobs." className={className}>
      {!nextJob ? null : (
        <div className="px-4 py-4 sm:px-5">
          <p className="text-sm font-semibold text-moonstone-700">
            {formatDateTimeShort(nextJob.startAt.toISOString())}
          </p>
          <p className="mt-0.5 text-lg font-semibold wrap-break-word text-admin-text">
            {nextJob.name}
          </p>
          {where && <p className="wrap-break-word text-admin-text-secondary">{where}</p>}
          {/* One row of equal buttons; whichever of Call and Maps the job lacks drops out.
              A calendar-only job has no booking record, so Open goes to its schedule day. */}
          <div className="mt-4 grid auto-cols-fr grid-flow-col gap-2">
            {nextJob.phone && (
              <AdminButton
                variant="secondary"
                href={`tel:${nextJob.phone}`}
                className={BIG_BUTTON_CLS}
              >
                <FaPhone aria-hidden />
                Call
              </AdminButton>
            )}
            {nextJob.address && (
              <AdminButton
                variant="secondary"
                href={mapsSearchUrl(nextJob.address)}
                className={BIG_BUTTON_CLS}
              >
                <FaLocationDot aria-hidden />
                Maps
              </AdminButton>
            )}
            <AdminButton href={nextJob.href} className={BIG_BUTTON_CLS}>
              Open
              <FaArrowRight aria-hidden />
            </AdminButton>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
