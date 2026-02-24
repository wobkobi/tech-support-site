# My Site for Tech Support

trying to get job

## Build Workflow & Asset Generation

### Automated (Pre-commit Hook)

Every commit automatically runs:

1. **Icon generation** (`npm run build:icons`) - Regenerates 37 favicon/social/QR assets from source
   files
2. **Next.js build** (`npm run build`) - TypeScript compilation and bundle optimization
3. **Lint/format/test** (`lint-staged`) - Code quality checks

**Total time**: ~24 seconds per commit

**To skip** (emergency only): `git commit --no-verify`

### Manual: Poster PDF Generation

The marketing flyer (`public/downloads/poster.pdf`) must be regenerated manually when the `/poster`
page design changes.

**When to regenerate**:

- Logo, colors, or typography changes
- Contact info or pricing updates
- QR code or layout modifications

**How to regenerate**:

```bash
# Option 1: From production (after deploying poster changes)
npm run build:poster

# Option 2: From localhost (during development)
npm run dev              # Terminal 1 - keep running
npm run build:poster -- --local    # Terminal 2
```

**After generation**:

```bash
git add public/downloads/poster.pdf
git commit -m "chore: regenerate poster PDF"
```

**Note**: Poster generation requires Puppeteer to screenshot the `/poster` page at A5 dimensions
(600 DPI). This is intentionally manual to avoid slowing down every commit.

---

## External Cron Configuration

This project relies on external cron jobs (via [cron-job.org](https://cron-job.org)) to handle
scheduled tasks. Vercel's Hobby plan only allows 1 cron job with daily minimum intervals, so we
trigger our endpoints manually every 15 minutes.

### Cron Jobs

Three endpoints run on a 15-minute schedule:

| Endpoint                           | Purpose                                             | Frequency    |
| ---------------------------------- | --------------------------------------------------- | ------------ |
| `/api/cron/release-holds`          | Release expired booking holds (15-min TTL)          | Every 15 min |
| `/api/cron/send-review-emails`     | Send review request emails 30 min after appointment | Every 15 min |
| `/api/cron/refresh-calendar-cache` | Refresh Google Calendar cache for availability      | Every 15 min |

### Setup Instructions

1. Log into [cron-job.org](https://cron-job.org)
2. For each endpoint above, create a new cron job with:
   - **URL:** `https://tothepoint.co.nz` + endpoint path (e.g.,
     `https://tothepoint.co.nz/api/cron/release-holds`)
   - **HTTP Method:** GET
   - **Frequency:** Every 15 minutes
   - **Headers:** Add custom header
     - **Name:** `Authorization`
     - **Value:** `Bearer <CRON_SECRET>` (retrieve `CRON_SECRET` from Vercel environment variables)
   - **Notifications:** Enable email alert after **3 consecutive failures**

### Manual Trigger (Fallback)

If cron-job.org is unavailable, manually trigger any endpoint:

```bash
# Example: release holds
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://tothepoint.co.nz/api/cron/release-holds

# Example: send review emails
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://tothepoint.co.nz/api/cron/send-review-emails
```

Replace `$CRON_SECRET` with the actual secret from Vercel environment variables. Both endpoints
return JSON indicating success/failure and how many items were processed.

### Monitoring

- **cron-job.org dashboard:** Check execution history and success rate
- **Vercel logs:** Search for `[review-email]`, `[cron/release-holds]`, or
  `[cron/refresh-calendar-cache]` to see endpoint activity
- **Alerts:** cron-job.org will email the owner if any job fails 3 times in a row
