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
- **U8a Security**: cross-tenant reads, webhooks and disabled apps.
  - `viewer.availability.user` answers only for the caller's own username, and an `eventTypeId` only for an event type the caller has access to; a user with role `ADMIN` may read any user's availability.
  - Only a user with role `ADMIN` may list, read, create, edit, test or delete webhooks: every procedure of the webhook router refuses anyone else, and so do Zapier's and Make's subscription routes. The Webhooks settings entry, the webhook settings pages and the event type's Webhooks tab are hidden from non-admins. Webhook delivery is unchanged.
  - An app switched off under Settings → Admin → Apps stays off server-side. Event type create, update and duplicate, and the bulk update to the default conferencing app, refuse to turn a disabled app on in `metadata.apps` or to add its location (Google Meet, Cal Video, ...); an event type that already has one can still be saved, and turning an app off always works. A disabled app can't become a user's default conferencing app either. The booking page and the booking success page leave disabled apps out of the event type's metadata, so their tags are not loaded. `/api/integrations/*` refuses a disabled app's routes (its own add, callback and custom endpoints; U8c also stops Google Meet being installed through Google Calendar's callback).
  - Google Calendar's connect and OAuth callback go through `/api/integrations/*`, so `google-calendar` must be enabled under Settings → Admin → Apps before anyone can connect a calendar.
- **U8c Security**: the 26 cross-tenant findings of the U8 audit, plus U8a's four review blockers.
  - *Booking uids:* a booking's uid comes from a CSPRNG, and so does the CalendarEvent builder's uid. They used to be uuidv5 of the tenant's username, the slot start and the creation millisecond, so an attacker could compute them, and a uid alone cancels a booking or shows it.
  - *Disabled apps fail closed:*
    - An `integrations:*` location type that maps to no enabled App row counts as a disabled app.
    - While `daily-video` is disabled, every Cal Video location books with no location and still sends its emails. That covers no location, a blank value, a conferencing default, a daily-video default, and an explicit or booker-sent `integrations:daily`. There are no Cal Video fallbacks.
    - `ensureAppsEnabled` also treats a new legacy `metadata.giphyThankYouPage` or a non-zero `price` as turning its app on.
    - Duplicating an event type that already holds such a value, or an unmapped `integrations:*` location, fails with `app_not_available_error`: the copy counts as new.
    - `daily-video` must never be enabled without valid Daily keys.
  - *Booker location:* a booking may use only a location the event type offers. `viewer.bookings.editLocation` refuses a disabled app's location, and a moved or confirmed booking does not keep one.
  - *Event types:*
    - `viewer.eventTypes.delete` authorizes the id it deletes.
    - Both event-type middlewares refuse an `id` and an `eventTypeId` that name different event types.
    - The delete and get input schemas are strict.
    - Duplicate refuses another tenant's personal event type.
    - Update, create and duplicate never write `parentId`, `teamId` or `profileId`.
    - Every schedule reference must be the caller's own schedule: `schedule`, `scheduleId`, `instantMeetingSchedule(Id)`, `hosts[].scheduleId` and the bulk default-availability update.
    - The webhook fan-out follows a parent event type only when it is a managed team event type, which never happens in this fork.
  - *Instance admin:* `isActiveInstanceAdmin` / `isActiveInstanceAdminSession` (`packages/features/auth/lib/isActiveInstanceAdmin.ts`) mirror the sign-in `validateRole`. An ADMIN signed in as `INACTIVE_ADMIN` (no 2FA, or a weak password) is not an admin on the server. That covers the webhook router, `availability.user`, the Zapier/Make subscriptions, `isAdminMiddleware`/`authedAdminProcedure`, and the admin and webhook settings pages. Every page under `settings/(admin-layout)` checks the admin itself, because an RSC partial render skips the layout. `adminFindById` selects no 2FA secret or backup code. `availability.user` is own-only and capped at 90 days.
  - *Webhooks:* the ownership middleware denies by default (a platform webhook: active admin only). SSRF:
    - self-hosted now runs the SaaS SSRF checks, unless `FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS=true` (exact value);
    - create, edit and test require https and resolve the hostname through DNS;
    - loopback, private, metadata and non-global-unicast targets are refused;
    - the test trigger times out after 10 s and doesn't follow redirects.
  - *`/api/link`:* the confirm/reject token uses AES-256-GCM with a key derived for this purpose (`symmetricEncryptAuthenticated`). `symmetricEncrypt`/`symmetricDecrypt` are unchanged, because they protect stored secrets. The route acts as the booking's organizer, and every bad token gets the same answer, so there is no padding oracle. Links in emails sent before U8c no longer work.
  - *Rate limits:* when `UNKEY_ROOT_KEY` is unset, `packages/lib/rateLimit.ts` counts the same limits in process, with bounded memory. A full store sends new keys to an overflow window and never evicts a live one.
    - The limiter is per process: set `UNKEY_ROOT_KEY` before running more than one replica.
    - Counters reset on every deploy.
    - `IP_BANLIST` must be a JSON array or unset, and it has no effect on callers that hash their identifier.
    - `NEXT_PUBLIC_IS_E2E` turns the limiter off (with the admin 2FA rule and Turnstile) and must never be set on Railway.
  - *Public procedures:*
    - `publicViewer.markHostAsNoShow` only reports a host no-show, only on an accepted booking that has started, and is limited per IP.
    - `checkIfUserEmailVerificationRequired` takes the session email from the session and is limited per IP.
  - *Google Calendar:* the OAuth callback requires a state nonce signed for the session user (403 otherwise), and `encodeOAuthState` always signs one. The add route refuses without `NEXTAUTH_SECRET`. Google Meet is installed from the calendar callback only while `google-meet` is enabled. The other apps' callbacks still treat state as optional: add the same check before enabling any of them.
  - *Selected calendars:*
    - `/api/availability/calendar` and `calendars.connectedCalendars` accept only the caller's own credential, event type and a calendar that credential lists.
    - The Google grant is kept on disconnect only when another user's live Google credential belongs to the same Google account.
    - Deleting a credential adds no Cal Video location while Cal Video is disabled.
  - *Intercom:* its script values are JSON-escaped. `apiKeys.create` refuses a disabled app.
  - *Bookings list:* `viewer.bookings.get` gives rows the caller doesn't organize a booker's view: no organizer id, no organizer email under `hideOrganizerEmail`, references reduced to `{type, meetingUrl, meetingPassword}`, no report, and only the caller's own phone number. `userIds` are authorized before any lookup.
  - *Public event data:* `getPublicEvent` returns no owner or host `metadata` or `defaultScheduleId`.
  - *Slot reservation is off:* `slots.reserveSlot` writes nothing and returns a fresh uid, `removeSelectedSlotMark` deletes nothing, and `getSchedule`/`isAvailable` ignore SelectedSlots. The public `getSchedule` drops `_enableTroubleshooter`, `_bypassCalendarBusyTimes` and `_silentCalendarFailures`.
- **U8d Security follow-ups** to U8c:
  - `getIP` ignores `cf-connecting-ip` and `true-client-ip` unless `TRUST_CLOUDFLARE_IP_HEADERS=true`, because there is no Cloudflare in front and the client can send those headers (live probe 2026-09-24). Otherwise the client IP is the first `x-forwarded-for` hop, which Railway's edge sets. Set the flag only behind Cloudflare with the origin locked to Cloudflare's IPs. Both flags are listed in `turbo.json` `globalEnv`.
  - Login limits, per David's decision:
    - 10 attempts per 60 s per typed email and client IP, checked before the user lookup;
    - 100 failed attempts per hour per account across all IPs (wrong password, or a wrong or missing TOTP or backup code). Once that is reached, the account is refused until the window resets.
    - A redeploy clears the windows, which is how the admin recovers early.
  - Email-code verification: `verifyCodeUnAuthenticated` runs a per-IP limit (10/60 s) before the per-email one when it is given the request. `sendVerifyEmailCode` also sends at most 5 codes per recipient in 10 minutes. A signed-in host may cancel 60 bookings a minute; anonymous cancel by uid stays at 10 a minute per IP.
  - Every webhook delivery re-checks the subscriber URL right before fetch: `sendPayload`, `WebhookService.sendWebhookDirectly` (BOOKING_REQUESTED through the tasker, and OOO), and the MEETING_STARTED/ENDED cron. A refused scheduled job is skipped and deleted. Refusals are logged without the URL. Zapier/Make `addSubscription` refuses such a URL.
  - The private-link hash and the password-reset link id come from a CSPRNG.
  - The legacy stripe `price` is gated on update and duplicate. Create's team-branch admin bypass uses the active-admin helper.
  - `handleConfirmation` gates the stored booking location, so a disabled app's location confirms as none. An offered-location refusal answers `location_not_offered_error` (en, sl).
  - `oAuth.updateClient`, `/auth/setup` and `/settings/license-key/new` use the active-admin helper.
  - tRPC's `errorConversionMiddleware` now really converts errors; it was dead code. A 4xx `HttpError` becomes its tRPC code, so a rate-limit denial is `TOO_MANY_REQUESTS`, and `ErrorWithCode` becomes its code. Only 5xx errors are reported, and the client does not retry `TOO_MANY_REQUESTS`.
  - A rate-limit refusal shows `rate_limit_exceeded` in the user's language on the booking form, the login, forgot-password and new-password views, and the host no-show toast. Report is offered only to the booking's host. Onboarding says a disabled conferencing app is not available.
  - The `/apps/installation` page no longer selects the App row's `keys`, which for google-calendar hold the platform's OAuth client_secret and reached any signed-in tenant through the page props (found by the U8 re-attack). The public email-code check passes its request, so its per-IP limit runs, and a limit refusal stays a 429. A missing or non-string email or password gets the unknown-email answer before any lookup, and `authorizeCredentials` no longer logs the credentials.
  - A hidden event type's private link (`/d/<hash>/...`) is a convenience, not access control: in this code anyone who knows the slug can still book it. Don't promise a client that a private link keeps an event type private.

## API v2 must not be deployed

The image builds only the web app (`./Dockerfile`); `apps/api/v2` (the `calcom-api` service in `docker-compose.yml`) is not part of the deployment and must stay out of it. Flowko's booker-facing fixes were made on the web app's routes and pages, not on API v2. There, `GET /v2/bookings/:bookingUid` (2024-04-15, no auth guard on the route) returns every seat's reference, and the 2024-08-13 `GET /v2/bookings/:bookingUid` and `/v2/bookings/by-seat/:seatUid` (optional auth) return every attendee's `seatUid` when the event type shows attendees. A seat's reference cancels that seat through `POST /v2/bookings/:bookingUid/cancel`. Deploying API v2 first needs an auth guard on those routes, or their output limited to the caller's own seat. It would also reopen U8c fixes that live only on the web app's tRPC routes: API v2 has its own SelectedSlots writers (slot reservation, AV-2) and accepts the internal `getSchedule` flags (AV-5), and its throttler keys on the client-sent `cf-connecting-ip` (`apps/api/v2/src/lib/throttler-guard.ts`).

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
