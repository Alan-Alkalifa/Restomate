# Restomate

Multi-tenant restaurant management SaaS (POS, orders, kitchen, tables, reservations, staff, reports, branded customer site). See `CLAUDE.md` for architecture and conventions and `docs/PLAN.md` for the plan.

## Prerequisites

Node >= 22 (24 recommended, see `.nvmrc`), pnpm 12.18.0 (`corepack enable && corepack prepare pnpm@12.18.0 --activate`), Docker, and the Supabase CLI.

## Quick start

```bash
pnpm install --frozen-lockfile
supabase start                 # local Postgres / Auth / Realtime / Storage (see "Local database")
supabase db reset              # migrations + seed
cp .env.example apps/web/.env.local   # then fill in the values (`supabase status` shows the local keys)
pnpm db:types                  # regenerate packages/db/database.types.ts
pnpm dev                       # http://localhost:3000
```

Other scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm db:test` (pgTAP).

### Database types (`@restomate/db`)

`packages/db` is a workspace package that exports `Database` and the helpers `Tables`, `TablesInsert`,
`TablesUpdate` and `Enums`. `database.types.ts` is **generated**; never edit it by hand. After any
migration: `supabase db reset && pnpm db:types`, and commit the result. In the app:
`import type { Database, Tables } from "@restomate/db"`.

### Local tenant hosts

In development the proxy also understands `localhost` hosts: `http://demo.localhost:3000` serves the
Demo Restaurant storefront, `http://app.localhost:3000` the dashboard, and `http://localhost:3000/?__tenant=demo`
is a path fallback. In production, unknown hosts return 404.

## Local database

Requires Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
supabase start        # local Postgres / Auth / Realtime / Storage
supabase db reset     # apply migrations, then supabase/seed.sql
supabase test db      # pgTAP tests (supabase/tests/)
```

Local services: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, **Mailpit (all auth emails) `http://127.0.0.1:54324`**.

### Seed data (local only)

`supabase/seed.sql` is for local development only. **Never run it against a production project.**
Every seed user has confirmed email and the same password, which is **not a secret**:

| | |
|---|---|
| Password (all users) | `restomate-local-dev` |

| Email | Where | Role |
|---|---|---|
| `admin@restomate.local` | platform | platform admin (`platform_admins`) |
| `owner@demo.local` | Demo Restaurant (`demo`) | Owner |
| `manager@demo.local` | Demo Restaurant | Manager |
| `cashier@demo.local` | Demo Restaurant | Cashier, **Jakarta Selatan only** |
| `waiter@demo.local` | Demo Restaurant | Waiter |
| `kitchen@demo.local` | Demo Restaurant | Kitchen |
| `owner@other.local` | Other Bistro (`other-bistro`) | Owner (cross-tenant test target) |

- **Demo Restaurant**: two locations (Jakarta Selatan, Bandung; `Asia/Jakarta`, IDR, tax 10% (PB1), service charge 5%), branding, trialing **Growth** subscription.
- **Other Bistro**: one location, its own owner, trialing **Starter** subscription; shares no rows with Demo.
- **Packages**: Starter / Growth (default trial plan) / Pro. Prices are **placeholders** (pricing is an open product question).
- The reserved slug `demo` is allowed only for the seeded org: the seed disables the `organizations_slug_not_reserved` trigger around that single insert and re-enables it.
- The seed is idempotent; `supabase db reset` always gives a clean state.
