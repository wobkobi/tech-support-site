"use client";
// src/features/business/components/calculator/UnfinishedJobsBanner.tsx
// Plain-calculator banner listing calendar jobs and re-issues left part-way, each with an Open
// link back to that job's calculator, where its own draft restores.

import { type JobDraftSummary, timeAgo } from "@/features/business/lib/calculator-draft";
import Link from "next/link";
import type React from "react";

interface Props {
  jobs: JobDraftSummary[];
  now: number;
}

/**
 * "Unfinished" list above the grid, so work typed on a job is found again from the menu.
 * @param props - Component props.
 * @param props.jobs - Job drafts with work in them, newest first.
 * @param props.now - When the calculator mounted, the "now" for the relative times.
 * @returns Banner element.
 */
export function UnfinishedJobsBanner({ jobs, now }: Props): React.ReactElement {
  return (
    <div className="mb-4 rounded-lg border border-admin-border bg-admin-bg px-4 py-2 text-sm text-admin-text">
      <p className="font-semibold">Unfinished jobs</p>
      <ul className="mt-1 flex flex-col gap-1">
        {jobs.map((job) => (
          <li key={job.key} className="flex flex-wrap items-center justify-between gap-x-3">
            <span>
              {job.clientName || "Job with no client"} - last edited {timeAgo(job.savedAt, now)}
            </span>
            <Link
              href={job.returnPath}
              className="font-semibold text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
