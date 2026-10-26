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
   - `BOOKING_CALENDAR_ID`, `WORK_CALENDAR_ID` (or `CAR_CALENDAR_ID`), `PERSONAL_CALENDAR_ID`,
     `HOME_ADDRESS` - calendar cache refresh.
   - `GOOGLE_SHEET_ID`, `GOOGLE_BUSINESS_SHEETS_FOLDER_ID` - sheets sync and subscription recording.
   - `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL` - booking reminder, invoice reminder, review ask
     and scheduled mailing-list emails.
   - `UNSUBSCRIBE_SECRET` - signs the unsubscribe link in mailing-list emails and the "stop asking
     me" link in review asks; neither goes out without it.
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

| Job                     | URL path                            | Method | Schedule         | Purpose                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------- | ------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar cache refresh  | `/api/cron/refresh-calendar-cache`  | GET    | every 30 minutes | Fetch Google Calendar events into the DB cache                                                                                                                                                              |
| Reconcile booking times | `/api/cron/reconcile-booking-times` | GET    | every 30 minutes | Pull corrected times back from Calendar, flag deleted events, retry booking-event deletes Google refused                                                                                                    |
| Booking reminders       | `/api/cron/send-booking-reminders`  | GET    | every 30 minutes | Email a 24h-out reminder for confirmed bookings                                                                                                                                                             |
| Invoice reminders       | `/api/cron/send-invoice-reminders`  | GET    | daily            | Chase overdue SENT invoices (max 2 nudges each)                                                                                                                                                             |
| Review asks             | `/api/cron/send-review-asks`        | GET    | daily 10:00 NZ   | Email the Google review ask N days after an invoice is sent                                                                                                                                                 |
| Sheets sync             | `/api/cron/sync-sheets`             | GET    | hourly           | Reconcile Cashbook/Expenses sheets with MongoDB                                                                                                                                                             |
| Contacts sync           | `/api/cron/sync-contacts`           | GET    | every 3 hours    | Two-way incremental Google Contacts sync                                                                                                                                                                    |
| Record subscriptions    | `/api/cron/record-subscriptions`    | GET    | daily 08:00 NZ   | Record due subscriptions as expenses + sheet row                                                                                                                                                            |
| Purge price estimates   | `/api/cron/purge-price-estimates`   | GET    | daily            | Delete price estimate logs past retention                                                                                                                                                                   |
| Public holidays         | `/api/cron/refresh-public-holidays` | GET    | monthly          | Refresh NZ public holidays (current + next year)                                                                                                                                                            |
| Scheduled publishing    | `/api/cron/publish-scheduled`       | GET    | every 5 minutes  | Post due social posts, send due emails, resume stuck runs, finish Resend broadcasts, bust the promo cache when a promo starts or ends, and once an hour line up posts in social schedules' empty time slots |
| Social sync             | `/api/cron/sync-social`             | GET    | every 30 minutes | Read new comments, reviews and messages for Social > Inbox, then each app's daily figures and each published post's figures for Social > Analytics                                                          |

Full URL = the production URL + the path above. cron-job.org lets you pick a timezone per job -
schedule Record subscriptions and Review asks in `Pacific/Auckland` so they keep their local time
across DST changes.

## Notes

- Routes respond synchronously with `{ ok: true, ...counts }`. The two sync jobs return 503 on
  failure so cron-job.org flags the run; the rest return 500 with an error message.
- No route sets `maxDuration`; every function runs on the project's 300 s default. Vercel bundles
  routes together only when their function config matches, and each bundle carries its own Prisma
  engine, so a per-route value splits off an extra bundle and inflates function storage. The two
  sync jobs make many sequential Google API calls, and a long sync run can outlive cron-job.org's 30
  s response window, so a cron-job.org "timeout" does not necessarily mean the run failed - check
  the Vercel function logs for the actual outcome.
- Overlapping or retried runs don't double-send: booking reminders claim `emailReminderSentAt` and
  invoice reminders claim `reminderCount`/`reminderLastSentAt` (compare-and-set) before sending, and
  hand the claim back when Resend refuses so the next run retries (max 2 invoice nudges, offsets
  live in the comms settings). A function killed between claim and send skips that reminder.
  record-subscriptions advances `nextDue` with a CAS guard and returns 500 when a record failed
  after its claim (record that one by hand), review asks claim each invoice (`reviewAskOutcome` >
  `sending`) before sending with a per-invoice Resend idempotency key, and the holidays refresh
  upserts, then prunes only once every year has fetched.
- Booking reminders send inside a window from `CANCELLATION.freeNoticeHours + 1` up to
  `comms.reminderLeadHours` before the start, so the reminder always lands while the customer can
  still cancel free.
- Tunable values (retention days, reminder lead hours, notification toggles) are read live from
  settings on every run; the reminder job no-ops cleanly when its toggle is off.
- Review asks go out `reviewAskDelayDays` after the invoice is emailed (or after it is marked paid,
  for one that was never emailed), at most one per person per `reviewAskGapDays`. Every invoice ends
  with a stamped outcome (`sent`, `skipped` with the reason, `cancelled`, or `failed`, retried once
  by the next run), and the job does nothing while Settings > Reviews > Automatic review asks is
  off. A claim left in `sending` for over an hour (a timed-out function) is set to `failed`. Pass
  `?invoiceId=` to run it for one invoice when testing locally.
- Cadences are set against each job's query shape, not picked for freshness alone - every run costs
  Vercel Fluid Active CPU, and the free tier only includes 4 CPU-hours a month. Catch-up jobs
  (invoice reminders, purge, subscriptions) query "everything not yet done" with no upper bound, so
  a slower cadence only delays them - it can never drop work. Booking reminders are the exception:
  they select a bounded window (`freeNoticeHours + 1` to `reminderLeadHours` out), so the cadence
  must stay shorter than the narrowest window the settings validator permits. That validator
  enforces `reminderLeadHours > freeNoticeHours + 1`, which on whole-hour inputs bottoms out at a
  1-hour window - hence 30 minutes here, and why this job must not be moved to hourly.
- Reconcile booking times runs ahead of the reminder job on purpose. The operator corrects event
  times in Calendar after a job, and deletes the event when one is called off, but the Booking row
  never followed - so reminders were timed off a stale start, or went out for a visit that never
  happened. This job copies corrected times back and stamps `calendarEventMissingAt` on a row whose
  event is gone; the reminder job skips a flagged booking until it is cancelled properly, and the
  flag clears itself if the event reads back. Only a 404, a 410 or an explicit `cancelled` status
  counts as gone, so a quota or auth blip never pauses mail. It uses a 7-day lookback, and the query
  has no upper bound, so every future booking is covered; `npm run reconcile:times:dry` and
  `npm run reconcile:times:apply` are the same pass by hand, with the wider 60-day default.
- It also re-arms a reminder stamp that cannot belong to a booking's current times.
  `emailReminderSentAt` is one-way - nothing else in the codebase clears it - so a row that has been
  moved carries the mark of a reminder sent for its old date, and the reminder job would skip it
  forever. The test is on the times themselves, not on whether this pass moved anything, because a
  row corrected by an earlier run or by either edit route has matching times and a stale stamp. A
  reminder counts as stale when it predates a start still in the future by more than 168 hours, the
  widest lead the settings validator allows, so it cannot have been sent for these times whatever
  the setting is; that also keeps the check free of a settings read, which the CLI script could not
  do anyway. Review asks hang off invoices, not booking times, so nothing here touches them.
- The same run retries `PendingCalendarDelete`. A cancel, a reschedule's old event or a rolled-back
  booking whose Google delete failed queues the event there rather than leaving it to block the slot
  and sit in the customer's calendar. Each run retries the queue oldest first with the original
  notify setting; an event already gone (404/410) clears its row. After 48 tries (a day) the row is
  dropped and the owner gets a push to delete the event by hand.
- Calendar cache rows live 60 minutes, twice the refresh cadence, so one late or missed run never
  expires the table. The booking page also serves rows up to 2 hours past their fetch while it
  refreshes in the background; the submit-time check always reads the calendars live, and adds the
  cached travel blocks so it refuses the same slots the grid greys out.
- Invoice reminders hold off on an invoice whose payment is already in the income ledger. Money
  entered straight into the Cashbook sheet never reaches the invoice (only `POST /pay` links the
  two), so a paid invoice can still read as SENT. A linked entry is proof; an unlinked entry
  matching the customer and the exact total is treated as likely and also stops the chase, since a
  nudge arriving late beats one arriving after payment. Either way the invoice page shows the match
  with a prompt to record it.
- Scheduled mailing claims each due campaign with an atomic `scheduled > sending` status flip, so
  overlapping runs can't send one twice, and every recipient has a `CampaignSend` row that is only
  marked sent once Resend accepts it. A send left in `sending` for over 10 minutes (a timed-out
  function) is re-claimed and only its pending rows go out, with the same Resend idempotency keys.
  Pending rows are re-checked against the list before every send, resume or retry, so anyone who
  unsubscribed, was deleted or was unticked since is dropped and a changed address gets it at the
  new one. A batch Resend didn't answer (no reply or a 5xx) stays pending for that resume rather
  than failing, since Retry's new keys could send a second copy. An idle run is four indexed
  queries, so the 5-minute cadence costs next to no Active CPU; it is that tight only so a scheduled
  email or post goes out close to the time the operator picked.
- A mailing-list email sent as a Resend broadcast stores each step (segment, contact import,
  broadcast, the send call) on the campaign before the next starts. A send still waiting on Resend's
  list upload is picked up 2 minutes after its run started, rather than 10, and carries on from that
  step; the send call itself is claimed first, so two runs can never both send it. An upload still
  unfinished after 30 minutes fails the run, so Retry uploads it again, and once a list loads, rows
  Resend left out of the segment or holds as unsubscribed are marked failed rather than sent. Once
  Resend reports a broadcast sent, the next run deletes its segment (the free plan allows 3). That
  runs before the quiet-hours check, since it sends nothing.
- Scheduled social posts use the same claim (`scheduled > posting`) and run before the quiet-hours
  check, so they go out at the time picked at any hour. Each platform's outcome is saved on the post
  as soon as it lands, so a resumed run (including one waiting on Instagram's picture processing)
  only posts to the platforms still pending, even when the run died part-way. A post that can't go
  at its time (its promo ended, an app isn't set up, a check fails) is marked failed at its slot
  with a push to the operator, and Retry sends it once it's fixed. When Meta doesn't answer a call
  that puts a post up, Instagram and Facebook reels keep their upload for the next run to check
  instead of posting again, and a Facebook post is looked for on the Page before it's called failed.
- Any pass of this job that throws (promo, social, schedule fill) still lets the others run, but the
  job then answers 500 with the failed passes listed, so cron-job.org flags the run.
- Social schedules are filled by the same job, at most once an hour: a run whose last fill (the
  `social:queueFilledAt` setting) is under an hour old skips it. The fill holds the
  `social:queueFill` run lock, so an overlapping run or a "Line up posts now" click can't double up
  a slot, and stops after 20 s; a fill cut short isn't stamped done, so the next 5-minute run
  carries on with the remaining slots. It lines up postings for Settings > Social & brand > "Line up
  posts ahead" days, never closer than 10 minutes away, and treats a slot as filled when any posting
  from that schedule holds the time. Slots you emptied by hand (unscheduled or deleted) are
  remembered and left empty. Nothing new needs registering on cron-job.org.
- Social sync reads comments and reviews first, under the `social:commentsSync` run lock (a held
  lock answers `comments: null`). Facebook and Instagram posts from the last 60 days are listed with
  their comment counts, and only posts whose count moved are read again, at most 30 a run; a post
  read in full has comments missing from it marked gone. Google reviews are read newest change first
  back to the last one seen, all of them (up to 1,000) on the first run or when Google counts fewer
  than before. Messenger and Instagram conversations that changed since the last read or in the last
  7 days come next (the last 60 days on the first run, at most 100 a run), each with its newest 20
  messages; a stored message missing from the read (in a longer chat, from among its newest 20) was
  unsent, so it's marked gone and its words are cleared. The first run of each app leaves threads
  older than 14 days read. A run stops starting reads after 90 s. A failed read keeps its reason for
  the Inbox to show and never stops the figures; a comments read that throws outright still lets the
  figures run, then the job answers 500 so cron-job.org flags it. A post or comment Meta reports as
  missing is only marked gone while the token can still see the Page or Instagram account, since
  lost access reads the same. The Inbox's Check now is turned away within 2 minutes of the last
  read. Move the cron-job.org job to every 30 minutes after the deploy that adds the Inbox.
- The figures part holds the `social:insightsSync` run lock, so an overlapping run or a Refresh
  press does nothing and answers `{ running: true }`. Each app's account days are read at most every
  6 hours: the last 30 days on the first run, then the last 3 again for Facebook and Instagram (the
  newest day settles late) and the last 5 for Google, which runs 3 days behind. Post figures are
  read once a post reaches 1 hour, 1, 3, 7 and 28 days (a story at 1, 6 and 23 hours, before it
  goes); a missed age is caught up once, not repeated. A run stops starting reads after 120 s or 40
  posts and the next run carries on, so no `maxDuration` is needed. A metric Meta rejects as invalid
  is left out for 7 days and one the token lacks the permission for for 1 day, so a missing scope
  costs one failed call a day, not one a post. The Refresh buttons in Analytics and on a post are
  turned away within 10 minutes of the last read. Register it on cron-job.org, every 30 minutes,
  after the deploy that adds it.
- Contacts sync runs local dedup/merge first, then pushes only the dirty set, then pulls Google's
  changes. The manual full sync lives at `/api/admin/contacts/sync`. Google calls are spaced 0.7 s
  apart (its 90-a-minute read quota) with one retry after 10 s; a rate limit that outlasts the retry
  ends the run, and the push stops starting contacts after 200 s. Longest-unsynced contacts go
  first, so the next run carries on where one stopped. A field with an open conflict is left alone
  on both sides until it's resolved.
- Sheets sync treats the sheet as source of truth, joining rows on the hidden column-Z Sync ID, and
  self-heals site entries whose sheet append failed.

## Adding a new job

1. Create `src/app/api/cron/<name>/route.ts` with a `GET` handler that checks `isCronAuthorized`
   first and returns 401 otherwise.
2. Don't export `maxDuration` - the 300 s project default covers it, and a per-route value adds a
   function bundle (see Notes).
3. Make the work idempotent - a run can be retried or overlap the next one.
4. Register the job on cron-job.org with the Bearer header and the intended cadence.
5. Add a row to the table above.
