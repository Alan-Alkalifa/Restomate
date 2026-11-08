# CI (`.github/workflows/ci.yml`)

Runs on every pull request and on push to `main`. One run per PR at a time (older runs are cancelled). No repository secrets are used; the build gets fake `NEXT_PUBLIC_*` values only.

| Job | Step | Reproduce locally |
|---|---|---|
| web | install (frozen lockfile) | `pnpm install --frozen-lockfile` |
| web | lint | `pnpm lint` |
| web | typecheck | `pnpm typecheck` |
| web | unit tests | `pnpm test` |
| web | build | `NEXT_PUBLIC_APP_URL=https://app.example.test NEXT_PUBLIC_ROOT_DOMAIN=example.test NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fake NEXT_PUBLIC_POSTHOG_KEY=phc_fake NEXT_PUBLIC_POSTHOG_HOST=https://posthog.example.test pnpm build` |
| database | start (Postgres only) | `supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` |
| database | reset | `supabase db reset` (migrations + `seed.sql`) |
| database | pgTAP | `supabase test db` (must end with `Result: PASS`; CI also greps for it, so a run that executes zero tests fails) |
| e2e | Playwright | disabled (`if: false`) until MF-T28 |

On failure the pgTAP log is uploaded as the `pgtap-log` artifact.

Notes
- Supabase CLI is pinned in the workflow (3.0.0); bump it deliberately.
- Node version comes from `.nvmrc`, pnpm from `packageManager` in `package.json`.
- A changed `package.json` without an updated `pnpm-lock.yaml` fails the install step (lockfile drift).
- If a build needs a real env value, add a fake one to the workflow; never a real secret.
