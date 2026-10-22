# Deploying (Vercel)

The app deploys to Vercel on push. Vercel's build command (`vercel.json`) is
`npm run db:push && npm run build`, so **every** build pushes the Prisma schema to MongoDB before
building - see the warning below.

## Pipeline gates

| Gate                                                    | Runs                                      | Checks                                                                                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pre-commit                                              | each commit                               | lock refresh (`npm update` + `npm install`, both `--package-lock-only`), lint-staged (`prettier --write` + `eslint --fix` on staged files), `typecheck`, `npm test` (every `scripts/check-*.ts`) |
| pre-push                                                | each push                                 | `lint` + `build` + `smoke` (localhost)                                                                                                                                                           |
| CI (`.github/workflows/ci.yml`)                         | PRs to `main`/`dev`, pushes to `main`     | `lint`, `build`, `tsc --noEmit`                                                                                                                                                                  |
| Post-deploy (`.github/workflows/post-deploy-smoke.yml`) | every Vercel `deployment_status: success` | remote smoke (`smoke-test.ts --url`) + `/api/health` probe                                                                                                                                       |

Nothing before the post-deploy step verifies the **live** deployment, so a missing/mis-escaped
Vercel env var, a runtime-only failure, or an unregistered cron passes every earlier gate. The
post-deploy workflow closes that gap.

> GitHub runs the post-deploy workflow from the deployed commit, so previews of any branch are
> smoked as well as production. Its check is `deployment-smoke`, which is not required on `main`:
> Vercel skips Dependabot previews (`ignoreCommand` in `vercel.json`), so those pull requests never
> get a run.

## Health endpoint

`GET /api/health`:

- **Public**: `{ ok: true, version }` - confirms the app serves and which version is live (the
  post-deploy probe asserts this matches the deployed SHA's `package.json`).
- **Authenticated** (admin cookie / `X-Admin-Secret` / cron `Bearer`): adds `checks.db` (a cheap
  `Setting` read) and `checks.env` (presence only, never values), and returns **HTTP 503** when the
  database is unreachable or a required env var is blank.

The env report and the boot-time fail-fast both read the **single required-env source**:
[`src/shared/lib/env.ts`](../src/shared/lib/env.ts) (`REQUIRED_ENV` - which includes `MONGODB_URI` -
and `RECOMMENDED_ENV`). The presence check trims, so it catches the `$`-expansion silent-blank case
(see "Required env vars" below) by name.

## Deploy-safety rules (apply to every change)

- **Schema changes are optional-fields-only** during active feature work - every deploy is
  roll-forward AND roll-backward safe (old code ignores new fields; new code handles null). No
  required fields without an explicit backfill step.
- **`npm run db:push` runs before merging** code that reads new fields (indexes / uniques exist
  before traffic). It happens automatically on the branch's preview build - see the warning below.
- **New env vars are added to Vercel (all environments) before the merge that reads them**; verify
  with `/api/health` after deploy.
- **New cron routes are registered on cron-job.org immediately after the prod deploy** that ships
  them, and [`docs/CRON.md`](CRON.md) is updated in the same commit as the route.
- **MongoDB + Prisma `@default` gotcha**: a non-optional field with `@default` is NOT backfilled by
  `db push`, and Prisma throws when reading existing rows that lack it. Ship new numeric/flag fields
  as nullable (`Int?`) and treat null as the default in readers.

## `db:push` runs on EVERY build

`vercel.json`'s build command runs `npm run db:push` on **every** build - previews of unmerged
branches included. So **a pushed branch mutates the shared MongoDB schema before any merge**. This
is safe ONLY because of the optional-fields-only rule above, which is why that rule is load-bearing:
never push a branch that adds a required field, renames a field, or drops one.

## Deployment Protection + automation bypass

- **State (record here):** _(TODO - check Vercel > Project > Settings > Deployment Protection; note
  Standard Protection on/off)_
- If protection is **on**, preview URLs sit behind Vercel's SSO wall and every automated request
  401s. Generate the **"Protection Bypass for Automation"** secret in the same settings page and
  mirror it as GitHub repo secrets, along with the admin secret:
  - `VERCEL_AUTOMATION_BYPASS_SECRET`
  - `ADMIN_SECRET` (must equal the **deployed** environment's value)
- The remote smoke (`smoke-test.ts --url`) and the health probe send `x-vercel-protection-bypass` (+
  `x-vercel-set-bypass-cookie`) **scoped to the deployment origin only** - never to third-party
  hosts. If protection is off, the bypass secret is simply unused.

## Rollback

A broken deployment - preview or production - is flagged by the post-deploy workflow within minutes
(a red run + GitHub notification). To recover production: **Vercel dashboard > Deployments > the
last-good deployment > Promote to Production** (instant, no rebuild). For a bad preview, push a fix
or redeploy.

## Cron registration checklist

- One [cron-job.org](https://cron-job.org/) job per route under `src/app/api/cron/`, each a plain
  `GET`.
- Every job sends `Authorization: Bearer <CRON_SECRET>` (same value as the Vercel env var). Gate is
  `isCronAuthorized` (`src/shared/lib/auth.ts`).
- Full route list + cadences: [`docs/CRON.md`](CRON.md) - keep its table in sync.

## Platform latency checklist (record actual state)

User-reported slow admin loads (e.g. invoice detail) are usually cold starts or a region mismatch,
not query cost. Record the real state:

- [ ] **Fluid compute enabled** (Vercel > Project > Settings > Functions) - kills most cold-start
      pain.
- [ ] **Function region colocated with the MongoDB Atlas cluster region** - a mismatch multiplies
      EVERY serial DB round trip and is the single biggest admin-latency lever.

Measure before optimising with the Server-Timing helper
([`src/shared/lib/server-timing.ts`](../src/shared/lib/server-timing.ts)): `ServerTimer.toHeader()`
sets a `Server-Timing` response header on route handlers (browser Network tab > Timing), and
`ServerTimer.log()` prints a breakdown to the server logs from server components (which cannot set
response headers).

## Required env vars

Single source: [`src/shared/lib/env.ts`](../src/shared/lib/env.ts). All must be present and
non-blank in each Vercel environment.

- **Critical** (app cannot serve): `MONGODB_URI` (the schema datasource reads `env("MONGODB_URI")`),
  `ADMIN_SECRET`, `CRON_SECRET`.
- **Recommended** (a missing one degrades a feature, never fatal): the Google OAuth quartet,
  `BOOKING_CALENDAR_ID`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `OPENAI_API_KEY`,
  `GOOGLE_MAPS_SERVER_KEY`, `HOME_ADDRESS`, `GOOGLE_SHEET_ID`, `GOOGLE_BUSINESS_SHEETS_FOLDER_ID`,
  and for Social `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`,
  `GOOGLE_BUSINESS_ACCOUNT_ID`, `GOOGLE_BUSINESS_LOCATION_ID` (see Social connections below).
- **Optional:** `META_APP_ID` and `META_APP_SECRET` - let Social read the Meta token's permissions
  as the app. Without them the Page token inspects itself, which works while the token does; with
  them, a dead token still shows why.
- **Optional:** `MAILING_FROM` - sender for mailing-list emails, like
  `Harrison at To The Point Tech <news@tothepoint.co.nz>`; falls back to `EMAIL_FROM`. A separate
  address means a reader who blocks the list or reports it as spam still gets booking emails. Any
  address on the domain verified in Resend works; replies go to `ADMIN_EMAIL`.

**The `$`-expansion trap:** locally, `.env.local` runs through dotenv-expand, which expands `$VAR`
inside every value (single-quoted included). A value containing `$` must be single-quoted with the
`$` escaped as `\$` (e.g. `CRON_SECRET`, `SMTP_PASS`) or it silently expands to empty. On Vercel,
set the literal value. A blanked var surfaces by name in `/api/health` and in the fail-fast asserts.

## Social connections

Social > Overview shows whether each app connects and what each can do. Facebook and Instagram go by
the Meta token's permissions (`debug_token`); Google goes by a read against each Business Profile
API. Both are cached for 10 minutes; Check again asks straight away.

**A Meta token that doesn't run out:** a System User token, swapped for the Page's own token.

1. Meta Business Suite > Settings > Users > System users > Add, with the Admin role.
2. Assign it the Page and the Instagram account, with full control.
3. Generate a token for the app, set to never expire, with the permissions the Overview's "Make a
   Meta token that doesn't run out" step lists (posting, take-downs, stats, comments, cover photo
   and messages).
4. In the Graph API Explorer, with that token, get `{META_PAGE_ID}?fields=access_token`.
5. Set the result as `META_PAGE_ACCESS_TOKEN` on Vercel and in `.env.local`, redeploy, then press
   Check again.

The Overview warns when the token stops working, or when it or its data access ends within 14 days.

**Probe:** `npm run probe:meta` makes GET calls only and prints what the token can read: its
permissions and dates, Page, post and Instagram stats under each metric name, whether comments come
back with who wrote them, and the Instagram posting quota.

**How it's set up (2026-10-23):**

- The app's use cases are Manage everything on your Page, Manage messaging & content on Instagram
  (its "API setup with Facebook login" side; the `instagram_business_*` permissions belong to the
  Instagram-login side, which the site doesn't use) and Engage with customers on Messenger.
- Meta refused every name for a new system user, so the token comes from the existing "Conversions
  API System User", which was given the To the Point Posting app and the Instagram account with full
  access. Don't press its Revoke tokens without checking it only revokes this app's tokens: the same
  system user holds the ad tracking token.

**State on 2026-10-23** (Page token for the "To the Point Posting" app, never runs out, data access
never ends; the probe shows all 15 permissions the Overview lists):

- Posting and take-downs work on all three apps.
- Post views are `post_media_view`; `post_media_views` and `post_impressions` are rejected as
  invalid metrics.
- Page insights, Instagram account and media insights, and Facebook comments now answer.
- Google posts, reviews and the Business Profile Performance API all answer.
- Every permission is "Ready for testing" (Standard access): it works for people with a role on the
  app. Messages and comments from the public need Live mode, Business Verification and Advanced
  access through App Review.
- Live mode: not checked yet. Whether posts made through the API show to the public, and whether
  comments from people without a role on the app come back with who wrote them, decide if the app
  needs Live mode (and App Review) before the comments inbox.

**Media (several pictures, reels, stories, cover photos):**

- Videos go from the browser straight to the Blob store, past Vercel's 4.5 MB request limit, using a
  token from `/api/admin/social/video-upload`. That token only allows MP4 or MOV up to 250 MB under
  `social/video/`, plus JPEG cover frames. It needs `BLOB_READ_WRITE_TOKEN`; `onUploadCompleted`
  isn't used, so local uploads work.
- Meta fetches each video from its Blob address, so the store must stay public.
- Make a story and the reel cover frame draw stored files into a canvas. That needs the Blob store
  to keep sending `Access-Control-Allow-Origin: *`, which it did on 2026-10-22.
- A video the apps are still processing carries across publish-cron passes, checked again 4 minutes
  after each. Instagram drops an upload still unfinished after 24 hours, and that app fails with a
  Retry.
- Stories and cover photos can't be taken down from the site.
- A cover photo needs `pages_manage_metadata`.
- Not yet tried on the real accounts: a carousel, a reel, a story and a cover photo.

**Stats (Social > Analytics, each post's Stats card):**

- Read by the `/api/cron/sync-social` job (see CRON.md); register it on cron-job.org after the
  deploy that adds it.
- Facebook figures need `read_insights` and Instagram's need `instagram_manage_insights`. Without
  them the page says which permission is missing. Instagram's likes and comments still come from the
  post itself; a Facebook post's reactions and comments need `pages_read_user_content` too.
- Google figures need the Business Profile Performance API turned on in Google Cloud. Google gives
  no figures for single posts, only for the profile, and runs about 3 days behind.
- Facebook gives no figures for stories, and a cover photo has none.
- Facebook's day runs on Pacific time, so its daily figures don't line up exactly with NZ days.
- Check one post and one day against Meta Business Suite and the Business Profile dashboard once the
  permissions are in.

**Comments and reviews (Social > Inbox):**

- Read by `/api/cron/sync-social` every 30 minutes (see CRON.md), or straight away with Check now.
- Google reviews need nothing more: they're read and answered through the Business Profile API with
  the existing `business.manage` scope. A reply replaces any earlier one, and only our reply can be
  deleted, never the review.
- Facebook comments need `pages_read_user_content` to read and `pages_manage_engagement` to reply,
  hide or delete. Instagram's need `instagram_basic` and `instagram_manage_comments`. Until the
  token has them, the Inbox names the permission Meta asked for and the other apps carry on.
- A comment that comes back without its writer (a Development mode app only sees people with a role
  on it) shows as "Someone". If every comment comes back like that once the permissions are in, the
  app needs Live mode.
- Suggest a reply uses the AI writers' provider (feature `social-reply`) with the live business
  facts; nothing is ever sent without pressing Send.

**Messages (Social > Inbox, Messages):**

- Messenger and Instagram conversations are read by the same `/api/cron/sync-social` job and Check
  now, with `pages_messaging` and `instagram_manage_messages`. Each conversation keeps its newest 20
  messages. Pictures, videos, stickers and story replies show as a line saying what was sent.
- A reply goes through the Send API as a `RESPONSE`, so it only works within a day of the person's
  last message. After that the Inbox says so and links to the app. Messenger takes 2,000 characters
  and Instagram about 1,000 (counted in bytes, so emoji use more).
- Messages can't be hidden or deleted from the site; Archive puts a chat away.
- Every read takes in the last 7 days of chats again, so a message the sender unsends drops out of
  the next one (or Check now): it shows as "Unsent" and its words are cleared from the database. A
  chat whose every message was unsent leaves the Inbox until they write again.
- With Standard access (the app in Development mode) Meta only returns chats with people who have a
  role on the app. Customers' messages need Live mode, Business Verification and Advanced access for
  `pages_messaging` and `instagram_manage_messages` through App Review.
- Dev run on 2026-10-23: one Instagram chat (Harrison's own second account, only the Page's
  messages) and no Messenger chats. No message has been sent from the site yet.
