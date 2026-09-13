# AKR General Trading — ERP

## This repository is the one that deploys

**Railway builds `mdabdulkasim1/AKR-GENERAL-TRADING`, branch `main`, from the repository root.**
Push here. Auto-deploy is on, so a push to `main` deploys itself.

There is a second copy of this application at `mdabdulkasim1/samiha-hospitals` under an
`akr-erp/` subdirectory. **Nothing deploys it.** Four days of work were once pushed there and
every redeploy faithfully rebuilt an older commit, because the running screens of a stale
deployment look exactly like a current one. If work is done in that copy, it has to be brought
across to this repository before it means anything.

## Telling whether a deployment is current

The application says which commit it is running, in three places, so this can never go unnoticed
again:

- the corner of the **sign-in page** — no password needed, readable on a phone
- the **sidebar**, under the person's name
- **`/api/health`**, as `release` and `branch`

It comes from `RAILWAY_GIT_COMMIT_SHA`, which the platform sets. Where the platform says nothing,
nothing is claimed.

`/api/health` also answers the two questions worth asking from outside:

- `storage` — `volume` means the books survive a deploy; **`ephemeral` means they do not**
- `branding.mark` — `uploaded`, `environment`, or `bundled`

## The logo

Three ways in, and each one overrides the one below it:

1. an upload under **Masters → Logo**
2. `COMPANY_LOGO_URL` or `COMPANY_LOGO_DATA` on the service — held by the platform, so these
   survive a deploy even with no volume mounted, which an upload does not
3. the mark drawn in `public/assets`, which ships with the code

## Before pushing

`npm test` — the suite covers the trade end to end, both desks and the printed documents.
