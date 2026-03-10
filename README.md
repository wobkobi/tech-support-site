# My Site for Tech Support

trying to get job

Built this from scratch with Next.js 16, TypeScript, and Tailwind CSS v4. It's a live booking
platform with Google Calendar sync, automated review emails, and a custom admin panel. Pretty happy
with how the mobile responsiveness turned out.

## What I Built

**Tech stack:**

- Next.js 16 (App Router + Turbopack)
- TypeScript & TSX
- Prisma ORM (PostgreSQL)
- Tailwind CSS v4 with custom design tokens (5-color palette: Rich Black, Seasalt, Coquelicot,
  Russian Violet, Moonstone)
- Google Calendar API for real-time availability
- Automated emails via SMTP
- Vitest for testing (323+ tests passing)
- Deployed on Vercel

**Features:**

- Real-time booking system with 15-min hold TTL to prevent double-bookings
- Google Calendar integration for availability checks (cached every 15min)
- Automated review requests sent 30min after appointments
- Admin dashboard for review moderation
- Mobile-first responsive design (navbar and booking form were tricky to get right)
- Custom lazy-loading hook with IntersectionObserver
- Polymorphic Button component (works as links or buttons)
- Marketing poster generator with print-ready PDFs (A5 + 3mm bleed, 600 DPI)

**What I learned:**

- Proper mobile responsiveness (fixed-width elements on mobile are evil)
- Managing concurrent bookings with database holds
- Working with timezones (Pacific/Auckland NZDT/NZST handling)
- Setting up external cron jobs (Vercel Hobby plan limitations)
- Building accessible forms with proper ARIA attributes
- Pre-commit hooks for code quality (Prettier, ESLint, tests)

## Quick Commands I Use

```bash
npm run dev              # Start dev server
npm run build            # Production build
npm run test             # Run tests in watch mode
npm run test:run         # Run tests once
npm run build:icons      # Regenerate 37 favicon/social assets
npm run build:poster     # Regenerate marketing PDFs
npx prisma studio        # Visual database editor
npm run db:seed          # Load test data
npm run db:unseed        # Clear database
```

## Build Workflow

Pre-commit hooks automatically run icon generation, Next.js build, prettier, eslint, and tests (~24
seconds total). Icon generation creates 37 favicon/social/QR assets from source files.

Marketing poster PDFs (digital + print with 3mm bleed) are generated manually via
`npm run build:poster` when the design changes. Uses Puppeteer to screenshot the `/poster` page at
600 DPI.

## Cron Jobs Setup

Had to use external cron service ([cron-job.org](https://cron-job.org)) since Vercel Hobby plan only
allows 1 cron job with daily minimum. Set up 3 endpoints that hit every 15 minutes:

- `/api/cron/release-holds` - Releases expired booking holds (15-min TTL)
- `/api/cron/send-review-emails` - Sends review requests 30min after appointments
- `/api/cron/refresh-calendar-cache` - Keeps Google Calendar availability fresh

Each endpoint needs `Authorization: Bearer $CRON_SECRET` header. Set up email alerts on cron-job.org
for 3 consecutive failures.
