# Flowko fork of Cal.diy

This repository is Flowko's fork of [Cal.diy](https://github.com/calcom/cal.diy), the MIT community fork of Cal.com. It is self-hosted at https://booking.flowko.si for Slovenian real-estate agencies and hair and beauty salons: one Cal.diy user per business or per agent, and bookers are their customers.

## Upstream

Pinned to `calcom/cal.diy` commit `54343aa685ae8f33159d2f485ec4a57bad5c574a` (2026-09-20, "fix: restore @ts-expect-error for CacheProvider type mismatch (#30171)"). The `flowko` branch is that commit plus the changes below.

## Changes vs upstream

- **U1 Slovenian rendering**: `sl` locale enabled, with Slovenian dates and 24-hour times in the booker and in emails.
- **U2 Build pipeline**: upstream workflows and actions removed; `.github/workflows/build-image.yml` builds the image natively on linux/amd64 and pushes it to GHCR; the Dockerfile accepts the app name, company name, support address, sender name and signup lock as build args.
- **U3 Auth hardening**: no self-registration while signup is disabled, including through the magic-link email sign-in.
- **U4 Google privacy**: Google profile scope removed, access revoked at Google on disconnect, known booker-PII log lines removed.
- **U5 Branding**: Flowko name and assets in place of Cal.diy's.

## Rebuilding the image

Every push to `flowko` runs `.github/workflows/build-image.yml` on a GitHub-hosted `ubuntu-latest` runner. To run it by hand, open Actions → Build image → Run workflow. It pushes:

- `ghcr.io/davidvojvodic/flowko-booking:<commit sha>`, which is the tag to deploy
- `ghcr.io/davidvojvodic/flowko-booking:flowko-latest`

The `NEXT_PUBLIC_*` values are compiled into the image. To change one, edit the `env:` block at the top of the workflow and push. Only `NEXT_PUBLIC_WEBAPP_URL` can also change at runtime: `scripts/start.sh` rewrites it on boot. Secrets are never build args. `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, the real `DATABASE_URL`, SMTP and Google credentials are set only on the host. The build starts its own throwaway Postgres, as upstream's release pipeline does.

Do not build on an Apple-Silicon Mac. The Dockerfile's builder stage is pinned to `$BUILDPLATFORM`, so a `--platform linux/amd64` build there ships arm64 native binaries.

After the first push, check the GHCR package's visibility. A private package needs a token with `read:packages` on the deployment host.

## License

Cal.diy is released under the MIT License, Copyright (c) 2020-present Cal.com, Inc. See [LICENSE](./LICENSE), which is unchanged and must stay with every copy of this code.
