# Scheduled jobs (cron-job.org)

The cron endpoints are triggered by an external scheduler instead of Vercel Cron (`vercel.json` has
no cron block and the Vercel scheduler is not used). [cron-job.org](https://cron-job.org/) (free)
calls the endpoints over HTTPS on a schedule. Every job is a plain `GET` route under
`src/app/api/cron/`.

## Prerequisites

1. Deploy the app to Vercel and note the production URL.
2. Set these environment variables in the Vercel project (Settings > Environment Variables), since
   the functions read them at runtime:
   - `MONGODB_URI` - the MongoDB connection string (all jobs); the schema datasource reads
     `env("MONGODB_URI")`.
   - `CRON_SECRET` - a long random string; cron-job.org sends it as the bearer token. Contains a `$`
     locally, so in `.env.local` it must be single-quoted with the `$` escaped as `\$`
     (dotenv-expand expands `$VAR` even inside single quotes).
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` /
     `GOOGLE_OAUTH_REFRESH_TOKEN` - Google OAuth for the calendar, sheets and contacts jobs.
   - `BOOKING_CALENDAR_ID`, `CAR_CALENDAR_ID`, `WORK_CALENDAR_ID`, `PERSONAL_CALENDAR_ID`,
     `HOME_ADDRESS` - calendar cache refresh.
   - `GOOGLE_SHEET_ID`, `GOOGLE_BUSINESS_SHEETS_FOLDER_ID` - sheets sync and subscription recording.
   - `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL` - review request, booking reminder and invoice
     reminder emails.
   - `GOOGLE_MAPS_SERVER_KEY` - public holidays refresh. No fallback to `GOOGLE_MAPS_API_KEY`:
     next.config.ts publishes that one to the browser, so falling back would spend a publicly
     readable key on server-side quota. The key's Google Cloud project must have the **Calendar
     API** enabled and must not be API-restricted to Maps services only - the job reads the public
     NZ holidays calendar, not a Maps endpoint.

## Auth

Every cron route checks `Authorization: Bearer <CRON_SECRET>` via `isCronAuthorized`
(`src/shared/lib/auth.ts`); the old `x-vercel-cron` header path was removed in 1.49.4. In each
cron-job.org job, add a request header:

```
Authorization: Bearer <CRON_SECRET>
```

(Use the same value as the `CRON_SECRET` env var in Vercel.)

## Jobs

All endpoints are **GET**. Create one cron-job.org job per row.

| Job                     | URL path                            | Method | Schedule         | Purpose                                                      |
| ----------------------- | ----------------------------------- | ------ | ---------------- | ------------------------------------------------------------ |
| Calendar cache refresh  | `/api/cron/refresh-calendar-cache`  | GET    | every 30 minutes | Fetch Google Calendar events into the DB cache               |
| Release holds           | `/api/cron/release-holds`           | GET    | every 15 minutes | Cancel expired booking holds                                 |
| Reconcile booking times | `/api/cron/reconcile-booking-times` | GET    | every 30 minutes | Pull corrected times back from Calendar, flag deleted events |
| Review emails           | `/api/cron/send-review-emails`      | GET    | hourly           | Send review requests after completed bookings                |
| Booking reminders       | `/api/cron/send-booking-reminders`  | GET    | every 30 minutes | Email a 24h-out reminder for confirmed bookings              |
| Invoice reminders       | `/api/cron/send-invoice-reminders`  | GET    | daily            | Chase overdue SENT invoices (max 2 nudges each)              |
| Sheets sync             | `/api/cron/sync-sheets`             | GET    | hourly           | Reconcile Cashbook/Expenses sheets with MongoDB              |
| Contacts sync           | `/api/cron/sync-contacts`           | GET    | every 3 hours    | Two-way incremental Google Contacts sync                     |
| Record subscriptions    | `/api/cron/record-subscriptions`    | GET    | daily 08:00 NZ   | Record due subscriptions as expenses + sheet row             |
| Purge price estimates   | `/api/cron/purge-price-estimates`   | GET    | daily            | Delete price estimate logs past retention                    |
| Public holidays         | `/api/cron/refresh-public-holidays` | GET    | monthly          | Refresh NZ public holidays (current + next year)             |

Full URL = the production URL + the path above. cron-job.org lets you pick a timezone per job -
schedule Record subscriptions in `Pacific/Auckland` so it stays at 8am across DST changes.

## Notes

- Routes respond synchronously with `{ ok: true, ...counts }`. The two sync jobs return 503 on
  failure so cron-job.org flags the run; the rest return 500 with an error message.
- `sync-sheets` and `sync-contacts` set `maxDuration = 300` (many sequential Google API calls);
  everything else runs with `maxDuration = 60`. A long sync run can outlive cron-job.org's 30 s
  response window, so a cron-job.org "timeout" does not necessarily mean the run failed - check the
  Vercel function logs for the actual outcome.
- Overlapping or retried runs are safe by design: release-holds guards each update on status +
  expiry, booking reminders stamp `emailReminderSentAt` only after Resend accepts the send, invoice
  reminders stamp `reminderLastSentAt`/`reminderCount` the same way (max 2 per invoice, offsets live
  in the comms settings), record-subscriptions advances `nextDue` with a CAS guard, and the holidays
  refresh is a pure upsert.
- Booking reminders send inside a window from `CANCELLATION.freeNoticeHours + 1` up to
  `comms.reminderLeadHours` before the start, so the reminder always lands while the customer can
  still cancel free.
- Tunable values (retention days, reminder lead hours, notification toggles) are read live from
  settings on every run; the review and reminder jobs no-op cleanly when their toggle is off.
- Cadences are set against each job's query shape, not picked for freshness alone - every run costs
  Vercel Fluid Active CPU, and the free tier only includes 4 CPU-hours a month. Catch-up jobs
  (review emails, invoice reminders, purge, subscriptions) query "everything not yet done" with no
  upper bound, so a slower cadence only delays them - it can never drop work. Booking reminders are
  the exception: they select a bounded window (`freeNoticeHours + 1` to `reminderLeadHours` out), so
  the cadence must stay shorter than the narrowest window the settings validator permits. That
  validator enforces `reminderLeadHours > freeNoticeHours + 1`, which on whole-hour inputs bottoms
  out at a 1-hour window - hence 30 minutes here, and why this job must not be moved to hourly.
- Reconcile booking times runs ahead of both email jobs on purpose. The operator corrects event
  times in Calendar after a job, and deletes the event when one is called off, but the Booking row
  never followed - so reminders and review requests were timed off a stale start, or went out for a
  visit that never happened. This job copies corrected times back and stamps
  `calendarEventMissingAt` on a row whose event is gone; both email jobs skip a flagged booking
  until it is cancelled properly, and the flag clears itself if the event reads back. Only a 404 or
  an explicit `cancelled` status counts as gone, so a quota or auth blip never pauses mail. It uses
  a 7-day lookback, and the query has no upper bound, so every future booking is covered;
  `npm run reconcile:times:dry` and `npm run reconcile:times:apply` are the same pass by hand, with
  the wider 60-day default.
- It also re-arms send stamps that cannot belong to a booking's current times. `emailReminderSentAt`
  and `reviewSentAt` are one-way - nothing else in the codebase clears them - so a row that has been
  moved carries the marks of emails sent against its old date and is skipped by both jobs forever.
  The test is on the times themselves, not on whether this pass moved anything, because a row
  corrected by an earlier run or by either edit route has matching times and stale stamps. A
  reminder counts as stale when it predates the start by more than 168 hours, the widest lead the
  settings validator allows, so it cannot have been sent for these times whatever the setting is;
  that also keeps the check free of a settings read, which the CLI script could not do anyway. A
  review request counts as stale when it predates a finish that is still in the future and the
  customer has not reviewed, which is exactly the case where it was asking about a visit that had
  not happened. `reviewSendFailedAt` clears with it, since its one-shot retry would fire the request
  straight back out. A finish already in the past is a real completed job and is left alone.
- Invoice reminders hold off on an invoice whose payment is already in the income ledger. Money
  entered straight into the Cashbook sheet never reaches the invoice (only `POST /pay` links the
  two), so a paid invoice can still read as SENT. A linked entry is proof; an unlinked entry
  matching the customer and the exact total is treated as likely and also stops the chase, since a
  nudge arriving late beats one arriving after payment. Either way the invoice page shows the match
  with a prompt to record it.
- Contacts sync runs local dedup/merge first, then pushes only the dirty set, then pulls Google's
  changes. The manual full sync lives at `/api/admin/contacts/sync`.
- Sheets sync treats the sheet as source of truth, joining rows on the hidden column-Z Sync ID, and
  self-heals site entries whose sheet append failed.

## Adding a new job

1. Create `src/app/api/cron/<name>/route.ts` with a `GET` handler that checks `isCronAuthorized`
   first and returns 401 otherwise.
2. Set `maxDuration` to match the worst-case upstream latency.
3. Make the work idempotent - a run can be retried or overlap the next one.
4. Register the job on cron-job.org with the Bearer header and the intended cadence.
5. Add a row to the table above.
