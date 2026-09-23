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
