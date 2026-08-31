# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Sufria — a WhatsApp-first direct-ordering platform for restaurants. WhatsApp is the
first channel, not the product.

- Working folder: `sufria`
- Repository: `mozz-labs/sufria` (`git@github.com:mozz-labs/sufria.git`)
- Human-facing docs are in Arabic. Code, comments, and CI step names are English.

## Layout

pnpm workspace monorepo (`apps/*`, `packages/*`). Node `>=24 <25`, pnpm `9.15.0`
(pinned via `packageManager` — never pass a pnpm version in CI, it kills the run
with `ERR_PNPM_BAD_PM_VERSION`).

| Path | Package | What it is |
|---|---|---|
| `packages/shared` | `@sufria/shared` | Drizzle schema mirror + domain logic shared by every app |
| `apps/dashboard-api` | `@sufria/dashboard-api` | NestJS REST API for the restaurant dashboard |
| `apps/conversation-engine` | `@sufria/conversation-engine` | WhatsApp webhooks + order state machine |
| `apps/dashboard-web` | `@sufria/dashboard-web` | Next.js staff UI |
| `db/migrations` | — | Raw SQL. The single source of truth for the schema |
| `db/seed` | — | Dev-only fixtures |
| `tests/security` | — | Chain-isolation gate (mandatory) |
| `tests/db` | — | Critical-primitive checks + schema-drift detection |

All packages are `private` and unpublished; workspace deps use `workspace:*`.
Cross-package imports go through the package name (`@sufria/shared`), not relative
paths — except `tests/`, which imports `packages/shared/src/*` directly.

## Commands

```bash
pnpm db:up            # start PostgreSQL (Docker) and wait for it
pnpm db:migrate       # apply migrations
pnpm db:seed          # load dev fixtures
pnpm dev              # run all services in parallel
pnpm test:security    # chain-isolation gate — 12 assertions + 3 negative controls
pnpm test:db          # critical primitives + schema drift
pnpm verify           # format:check + lint + typecheck + test — run before any push
pnpm --filter @sufria/dashboard-web dev    # single package
```

`pnpm verify` needs a live database: `test:security` and `test:db` connect using
`DATABASE_URL` / `MIGRATION_DATABASE_URL` from `.env` (copy `.env.example`).

## Database names

| Thing | Name |
|---|---|
| Database | `sufria` |
| Application roles | `sufria_dashboard`, `sufria_engine` — neither is superuser or BYPASSRLS |
| Migration role | `postgres` (owns the tables; the app never connects as it) |
| Docker container / volume | `sufria-postgres` / `sufria-pgdata` |

`migrate.mjs` keeps no tracking table and `0001` has bare `CREATE TYPE`, so
migrations only ever run against a **clean** database — re-running against an
existing one fails loudly at `0001` by design. The upgrade path is always
`pnpm db:reset` (or drop and recreate the database on a native install; see
`docs/02-تجهيز-البيئة.md`).

## Rules that do not bend

1. **Do not upgrade past TypeScript `~5.9.3`.** TS 7 has no programmatic compiler
   API and breaks `nest build` and type-aware ESLint. See `docs/ADR-003`.
2. **The security gate is green or nothing merges.** A red `pnpm test:security`
   means one restaurant can read another's data. Blueprint §5.5.
3. **Migrations are append-only.** Once a migration has run on someone's machine,
   add `000N_...` instead of editing it.
4. **SQL is the source, TypeScript is the mirror.** `packages/shared/src/schema.ts`
   is maintained by hand. Never run `drizzle-kit generate` — it silently drops every
   RLS policy, CHECK constraint, and partial index. `pnpm test:db` catches drift.
5. **`DATABASE_URL` must be `sufria_dashboard` (or `sufria_engine`), never
   `postgres`.** A superuser bypasses RLS with no error at all, so isolation checks
   pass without checking anything. `TenantDbService` refuses to start if it detects
   a superuser or BYPASSRLS role.
6. **`.env` never reaches git.** If it does, rotate every key — deleting the file
   does not remove it from history.

## Known gaps

- **The apps' `test` scripts are fake.** `@sufria/dashboard-api`,
  `@sufria/conversation-engine`, and `@sufria/dashboard-web` each define `test` as
  an `echo` followed by `exit 0`. `pnpm -r test` — and therefore `pnpm verify` and
  the CI "Unit tests" step — reports a false success: **zero unit tests run.** The
  only checks with real coverage today are `test:security` and `test:db`. Treat a
  green `pnpm verify` as "the security gate and DB checks passed", never as "the
  test suite passed". Replace these placeholders with real Vitest suites before
  relying on them (`vitest` is already a root devDependency).
- `@sufria/conversation-engine` has no `src/main.ts` yet, so its `dev` and `start`
  scripts do not run. Only `src/db/*` exists.
