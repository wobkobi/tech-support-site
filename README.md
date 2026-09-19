# Tech Support Site

A tech support business site with online booking, built with Next.js 16, TypeScript, and Tailwind
CSS v4. Deployed on Vercel.

## Features

- Real-time booking with Google Calendar availability and 15-minute holds to prevent double-bookings
- Automated emails via Resend (booking confirmations, reminders, review requests)
- Admin dashboard for managing bookings, reviews, and settings
- Price estimator and marketing poster generator (print-ready PDFs)

## Tech stack

- Next.js 16 (App Router + Turbopack), React 19, TypeScript
- Tailwind CSS v4
- Prisma ORM with MongoDB
- Google Calendar API, Resend

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run smoke        # Smoke tests
npm run build:icons  # Regenerate favicon/social assets
npm run build:poster # Regenerate marketing poster PDFs
npx prisma studio    # Visual database editor
```

Pre-commit hooks handle formatting, linting, and builds automatically - no need to run them
manually.

## Vercel storage

Vercel keeps the serverless function bundle of every retained deployment, and that total is the
Function Storage quota (10 GB on the free tier). Two things keep it in check:

- `next.config.ts` excludes the unused Prisma runtimes (wasm engines for other databases, edge and
  browser builds) from the traced function output, which roughly halves the bundle per deployment.
- `vercel.json` skips preview builds for `dependabot/*` branches; GitHub Actions CI already builds
  those pull requests before auto-merge, so the preview deployment stored nothing useful.

Retention itself is a project setting, not code: Settings > Deployment Retention in the Vercel
dashboard. Shortening it (and deleting old deployments once) is what actually frees storage that has
already been used.

## Cron jobs

Scheduled tasks run via [cron-job.org](https://cron-job.org), hitting `/api/cron/*` endpoints with
an `Authorization: Bearer $CRON_SECRET` header. They handle releasing expired holds, refreshing the
calendar cache, sending reminder and review emails, and other maintenance.
