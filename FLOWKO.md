# Flowko fork of Cal.diy

This repository is Flowko's fork of [Cal.diy](https://github.com/calcom/cal.diy), the MIT community fork of Cal.com, self-hosted at https://booking.flowko.si.

## Upstream

Pinned to `calcom/cal.diy` commit `54343aa685ae8f33159d2f485ec4a57bad5c574a` (2026-09-20, "fix: restore @ts-expect-error for CacheProvider type mismatch (#30171)"). The `flowko` branch is that commit plus the changes below.

## Changes vs upstream

Lines marked *planned* are not on `flowko` yet; each is updated when its change merges.

- **U1 Slovenian rendering** (*planned*): `sl` locale enabled (`i18n.json` and the dayjs `sl` locale), with Slovenian dates in emails and booker month labels, and 24-hour email times for Slovenian recipients.
- **U2 Build pipeline**: upstream workflows and actions removed; `.github/workflows/build-image.yml` builds the image natively on linux/amd64 and pushes it to GHCR; the Dockerfile accepts the app name, company name, support address, sender name and signup lock as build args. `NEXT_PUBLIC_DISABLE_SIGNUP` now defaults to `true` in the Dockerfile, so every build, `docker compose` builds included, closes signup; pass `--build-arg NEXT_PUBLIC_DISABLE_SIGNUP=false` to reopen it.
- **U3 Auth hardening** (*planned*): no self-registration while signup is disabled, including through the magic-link email sign-in.
- **U4 Google privacy** (*planned*): Google profile scope removed, access revoked at Google on disconnect, known booker-PII log lines removed.
- **U5 Branding** (*planned*): Flowko name and assets in place of Cal.diy's.
- **U7b Platform hygiene** (*planned*): `scripts/seed-app-store.ts`, which `scripts/start.sh` runs on every boot, enables only `google-calendar` (from `GOOGLE_API_CREDENTIALS`). Every other app, Google Meet and the analytics and automation apps included, is created disabled, and the seed never changes the enabled flag of an existing row, so an admin's choice survives restarts. `yarn db-seed`/E2E (`scripts/seed.ts`) keeps upstream's behaviour. The `syncAppMeta` cron can now only disable apps, so a restart no longer switches off an app an admin enabled with missing keys. Booker details, calendar ids, webhook URLs and secrets, and credential keys are kept out of warn/error logs, and emails to the placeholder address of a phone-only booker are no longer sent. Reconnecting the same Google account replaces the earlier credential, a token discarded for missing scopes is revoked, and deleting an account revokes its Google grants first.
  - The seed never flips an existing row. On a database seeded before U7b, turn off Google Meet and the analytics and automation apps once under Settings → Admin → Apps.
  - After the first boot, `SELECT slug FROM "App" WHERE enabled;` should return only `google-calendar`.
- **U7d No seats or recurring series** (*planned*): `IS_SEATS_AND_RECURRING_ENABLED = false` in `packages/lib/constants.ts` turns off seated (`seatsPerTimeSlot`) and recurring (`recurringEvent`) event types. The event type create, update and duplicate handlers, which API v2 also calls, refuse to turn either on (turning them off still works). The booking service refuses a booking of a seated or recurring event type, a request that names a recurring series (a calendar's recurring event id included) or a seat, and a reschedule of a booking that still has seats or belongs to a recurring series; `/api/book/recurring-event` refuses every request. The Advanced tab's "Offer seats" setting and the Recurring tab are hidden. Cancelling existing bookings, seated ones included, is unchanged. Setting the constant to `true` restores upstream's behaviour; the seated and recurring E2E tests are skipped while it is `false`.

## API v2 must not be deployed

The image builds only the web app (`./Dockerfile`); `apps/api/v2` (the `calcom-api` service in `docker-compose.yml`) is not part of the deployment and must stay out of it. Flowko's booker-facing fixes were made on the web app's routes and pages, not on API v2. There, `GET /v2/bookings/:bookingUid` (2024-04-15, no auth guard on the route) returns every seat's reference, and the 2024-08-13 `GET /v2/bookings/:bookingUid` and `/v2/bookings/by-seat/:seatUid` (optional auth) return every attendee's `seatUid` when the event type shows attendees. A seat's reference cancels that seat through `POST /v2/bookings/:bookingUid/cancel`. Deploying API v2 first needs an auth guard on those routes, or their output limited to the caller's own seat.

## One-time GitHub setup

The fork's default branch is still `main`, which carries all of upstream's workflows, eleven of them scheduled (two run every minute). GitHub runs scheduled workflows only from the default branch, and shows the "Run workflow" button only for workflows on the default branch. These are repository settings, so the owner does them once, in this order:

1. Push the `flowko` branch.
2. Settings → General → Default branch: switch to `flowko`. Alternatively, push a commit to `main` that deletes `.github/workflows`.
3. Only then enable GitHub Actions for the fork in its Actions tab.
4. Start the first build by pushing a commit to `flowko`.

## Rebuilding the image

Every push to `flowko` runs `.github/workflows/build-image.yml` on a GitHub-hosted `ubuntu-latest` runner. Once `flowko` is the default branch, it can also be run by hand from Actions → Build image → Run workflow on `flowko` (any other branch is skipped). It pushes:

- `ghcr.io/davidvojvodic/flowko-booking:<commit sha>`, which is the tag to deploy
- `ghcr.io/davidvojvodic/flowko-booking:flowko-latest`

The workflow does not boot the image before pushing it (upstream's release pipeline does), so `flowko-latest` is untested. Deploy only a `<commit sha>` tag that has been started and checked.

The `NEXT_PUBLIC_*` values are compiled into the image. To change one, edit the `env:` block at the top of the workflow and push. Only `NEXT_PUBLIC_WEBAPP_URL` can also change at runtime: `scripts/start.sh` rewrites it on boot. Secrets are never build args. `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, the real `DATABASE_URL`, SMTP and Google credentials are set only on the host. This matters because the repository is public: `docker/build-push-action` then attaches a max-mode provenance attestation to the image, and that attestation records every build arg. The build starts its own throwaway Postgres, as upstream's release pipeline does.

Do not build on an Apple-Silicon Mac. The Dockerfile's builder stage is pinned to `$BUILDPLATFORM`, so a `--platform linux/amd64` build there ships arm64 native binaries.

After the first push, check the GHCR package's visibility. A private package needs a token with `read:packages` on the deployment host.

## License

Cal.diy is released under the MIT License, Copyright (c) 2020-present Cal.com, Inc. See [LICENSE](./LICENSE), which is unchanged and must stay with every copy of this code.
