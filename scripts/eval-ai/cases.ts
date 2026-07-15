// scripts/eval-ai/cases.ts
// Static golden cases for the eval harness. Single-task estimate cases are
// generated from the live benchmarks at runtime (see index.ts), so this file
// holds only the authored parse cases and multi-task estimate cases whose text
// does not depend on the operator's specific labels.

/** An authored parse-job case with an exact expected session total. */
export interface ParseCase {
  id: string;
  /** Operator notes sent to parse-job; MUST contain the stated times below. */
  input: string;
  /** Stated ranges the harness sums to the exact expected durationMins. */
  statedRanges: { startTime: string; endTime: string }[];
}

/** An authored multi-task estimate case (drift is report-only, no hard assert). */
export interface EstimateCase {
  id: string;
  description: string;
}

export const PARSE_CASES: ParseCase[] = [
  {
    id: "parse-single-2h",
    input: "9-11am\nSet up a new laptop and transfer files",
    statedRanges: [{ startTime: "09:00", endTime: "11:00" }],
  },
  {
    id: "parse-single-90m",
    input: "1-2:30pm\nFix Wi-Fi and set up a printer",
    statedRanges: [{ startTime: "13:00", endTime: "14:30" }],
  },
  {
    id: "parse-two-ranges",
    input: "9-10am onsite\n2-3pm more work same day",
    statedRanges: [
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "14:00", endTime: "15:00" },
    ],
  },
];

export const MULTI_ESTIMATE_CASES: EstimateCase[] = [
  {
    id: "est-multi-1",
    description: "Fix Wi-Fi, set up a new printer, and transfer files from an old laptop",
  },
  { id: "est-multi-2", description: "New PC setup with data transfer and install antivirus" },
];
