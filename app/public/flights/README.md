# Flight logs

This directory is intentionally empty in a fresh clone.

`/telemetry` replays real DJI TXT flight records. Those records, the AES
keychains that decrypt them, and the `index.json` catalog derived from both are
**not committed** and are gitignored.

## Why not

This repository is public, and `.github/workflows/deploy.yml` copies
`app/dist/.` (which includes everything under `app/public/`) to GitHub Pages.
Committing real logs would publish survey flight coordinates, timestamps,
aircraft serial numbers and the keys to decrypt every frame, both to a public
website and to permanent git history.

Every other operational figure in SENTINEL is synthetic. Real customer flight
data is not, and does not get the same treatment.

## Populating it locally

Drop DJI `.txt` flight records into this directory, named as
`<slug>.txt` where the slug is URL-safe. The convention in use is
`<model>-<YYYY-MM-DD>-<HHMM>.txt` with the time being the log's **UTC** start,
for example `m400-2026-02-17-0627.txt`. The bake tool uses each filename stem
as the flight id, so avoid spaces and brackets, which DJI's own filenames
contain.

Then:

```bash
node tools/bake-flights.mjs            # needs DJI_API_KEY in the repo-root .env
node tools/bake-flights.mjs --dry-run  # catalog only, no network, no key
```

This writes `index.json` and one `<id>.keychain.json` per encrypted log. The
browser then decodes everything offline.

DJI encrypts flight records from log version 13 onward, and DJI's keychain
endpoint sends no CORS headers, so the keys cannot be fetched from a browser.
That is the whole reason this bake step exists. See `.env.example` for the key,
which is never exposed to the client bundle.

## Without any logs

The module still runs. `io/catalogIo.ts` treats a missing or malformed
`index.json` as an empty catalog, so `/telemetry` loads with an empty library
and a working `LOAD LOG` drop-in path. Logs from before version 13 decode with
no keychain at all; version 13 and later dropped in this way will show their
metadata and report their frames as locked.
