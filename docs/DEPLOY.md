# Deploying (Vercel)

The app deploys to Vercel on push. Vercel's build command (`vercel.json`) is
`npm run db:push && npm run build`, so **every** build pushes the Prisma schema to MongoDB before
building - see the warning below.

## Pipeline gates

| Gate                                                    | Runs                                      | Checks                                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pre-commit                                              | each commit                               | lock refresh (`npm update` + `npm install`, both `--package-lock-only`), lint-staged (`prettier --write` + `eslint --fix` on staged files), `typecheck`, `check:addresses` |
| pre-push                                                | each push                                 | `lint` + `build` + `smoke` (localhost)                                                                                                                                     |
| CI (`.github/workflows/ci.yml`)                         | PRs to `main`/`dev`, pushes to `main`     | `lint`, `build`, `tsc --noEmit`                                                                                                                                            |
| Post-deploy (`.github/workflows/post-deploy-smoke.yml`) | every Vercel `deployment_status: success` | remote smoke (`smoke-test.ts --url`) + `/api/health` probe                                                                                                                 |

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
  `GOOGLE_MAPS_SERVER_KEY`, `HOME_ADDRESS`, `GOOGLE_SHEET_ID`, `GOOGLE_BUSINESS_SHEETS_FOLDER_ID`.

**The `$`-expansion trap:** locally, `.env.local` runs through dotenv-expand, which expands `$VAR`
inside every value (single-quoted included). A value containing `$` must be single-quoted with the
`$` escaped as `\$` (e.g. `CRON_SECRET`, `SMTP_PASS`) or it silently expands to empty. On Vercel,
set the literal value. A blanked var surfaces by name in `/api/health` and in the fail-fast asserts.
