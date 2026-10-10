# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Sufria — a WhatsApp-first direct-ordering platform for restaurants. WhatsApp is the
first channel, not the product.
- Working folder: `sufria`
- Repository: `mozz-labs/sufria` (`git@github.com:mozz-labs/sufria.git`)
- Human-facing docs (`docs/*`) are in Arabic. Code, comments, commit messages, and
  CI step names are English. `CLAUDE.md` is bilingual by design: repo facts in
  English, working agreements in Arabic.

## Layout

pnpm workspace monorepo (`apps/*`, `packages/*`). Node `>=24 <25`, pnpm `9.15.0`
(pinned via `packageManager` — never pass a pnpm version in CI, it kills the run
with `ERR_PNPM_BAD_PM_VERSION`).

| Path | Package | What it is |
|---|---|---|
| `packages/shared` | `@sufria/shared` | Drizzle schema mirror + domain logic shared by every app |
| `apps/dashboard-api` | `@sufria/dashboard-api` | NestJS REST API for the restaurant dashboard: orders and their status, restaurant settings (task D); the menu — `GET`/`POST /menu-items`, `PATCH /menu-items/:id` (name, price, availability, archive and bring back), `POST /menu-items/enable-all`, `GET /menu-categories` — and `PATCH /restaurant/orders-pause`, all under the 4096 guard where they can lengthen the menu (brief ي-أ, `docs/brief-ja-menu-backend.md`). Contracts as built: `docs/13-dashboard-api-brief.md` §9 (§9.10 for ي-أ) |
| `apps/conversation-engine` | `@sufria/conversation-engine` | WhatsApp webhooks, business-hours gate, session, browsing cart, pickup-or-delivery, address, and order creation (task C); the customer-notification poller (task F, `src/notify/`); the 60-minute session timeout (task H, `docs/17-session-timeout-brief.md`); orders paused and the empty menu (brief ي-أ §4, `src/conversation/orders-paused.ts`) |
| `apps/dashboard-web` | `@sufria/dashboard-web` | Next.js staff UI: login, the orders screen (task G, `docs/16-orders-screen-brief.md`) and an order's details with its conversation (task I, `docs/brief-i-order-details.md`). Feature-based: `app/` (routes) · `features/<x>/` · `shared/` — see *Dashboard structure*. Talks to `dashboard-api` at `NEXT_PUBLIC_API_URL` |
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
pnpm db:migrate       # apply the files not applied yet — safe on an existing database
pnpm db:seed          # load dev fixtures
# 🔴 Never `pnpm db:reset` on the demo restaurant's database: it wipes it, data and all.
# After ANY database rebuild, recreate the demo restaurant (brief E) — prints its staff password once:
node --env-file-if-exists=.env --import @swc-node/register/esm-register apps/dashboard-api/src/scripts/setup-restaurant.ts db/restaurants/demo.json
pnpm dev              # run all services in parallel
pnpm test:security    # chain-isolation gate — 15 assertions + 4 negative controls
pnpm test:db          # critical primitives + schema drift + the migration tool
pnpm check:rtl        # dashboard-web: logical properties only, no reversing (in verify and CI)
pnpm check:budget     # dashboard-web: JS + fonts before first paint, per page, vs perf-budget.json
                      # (builds first — stop `next dev`; NOT in verify; end of every brief, before every merge)
pnpm verify           # format:check + lint + typecheck + test — run before any push
pnpm --filter @sufria/dashboard-web dev    # single package
# Dev only, never a real restaurant: change an order's status through the API,
# as the dashboard button will (brief F §5). Needs DEMO_STAFF_EMAIL/PASSWORD in .env:
node --env-file=.env scripts/demo-order-status.mjs 101 accepted
# Dev only, the same way: the menu as the menu screen will drive it (brief ي-أ §6).
# <n> is the place in `list` (in `archived` for restore), not the customer's number:
node --env-file=.env scripts/demo-menu.mjs list          # also: archived
node --env-file=.env scripts/demo-menu.mjs pause         # also: resume
node --env-file=.env scripts/demo-menu.mjs price 1 ٣٫٧٥  # also: on <n> · off <n> · archive <n> · restore <n>
```

`pnpm verify` needs a live database: `test:security` and `test:db` connect using
`DATABASE_URL` / `MIGRATION_DATABASE_URL`, and the Jest suites `ENGINE_DATABASE_URL`
too.

🔴 **On the laptop, the tests always run with `.env.test` — never without it**
(Mohammed, 5 October 2026). `.env` points at the demo restaurant's real
database; a test run without `.env.test` writes into it, and the security gate's
negative controls flip `sufria_dashboard` to SUPERUSER and back on whatever
instance they reach.

The tests run on **a Postgres instance of their own**: `test`, on port **5434**
(`pg_createcluster 16 test --port 5434`), next to `main` on 5432 that holds the
demo. Its own roles — `postgres`, `sufria_dashboard`, `sufria_engine` — with
their own passwords, and one database, `sufria_test`. Roles belong to an
instance, so nothing a test does to a role reaches the demo's. `.env.test`
(`/root/sufria/.env.test`, mode 600, gitignored by `.env.*`; a worktree links
to it, as to `.env`) holds the three URLs. Exported, they win over `.env`
everywhere: Node's `--env-file` and both Jest `setup-env.ts` files keep a
variable that is already set. Every test command, then:

```bash
set -a && . ./.env.test && set +a && pnpm verify
```

`postgresql.service` starts both instances at boot, and so does
`sudo service postgresql start` (the instance is `auto` in
`/etc/postgresql/16/test/start.conf`). One stopped by hand while the service
is up: `sudo service postgresql@16-test start`.

On a new machine, once (as root; `<p0> <p1> <p2>` = three new passwords, e.g.
`openssl rand -hex 24`, written into `.env.test` as
`postgres://<role>:<p>@localhost:5434/sufria_test`):

```bash
pg_createcluster 16 test --port 5434 --encoding UTF8 --locale C.UTF-8 --start
sudo -u postgres psql -p 5434 -c "ALTER ROLE postgres PASSWORD '<p0>'" -c "CREATE ROLE sufria_dashboard LOGIN PASSWORD '<p1>'" -c "CREATE ROLE sufria_engine LOGIN PASSWORD '<p2>'"
set -a && . ./.env.test && set +a && createdb --maintenance-db="${MIGRATION_DATABASE_URL%/sufria_test}/postgres" -T template0 -E UTF8 --locale-provider=icu --icu-locale=ar-JO --locale=C.UTF-8 sufria_test
set -a && . ./.env.test && set +a && pnpm db:migrate
set -a && . ./.env.test && set +a && for f in chain-isolation-fixture dev-staff-passwords dev-contact-phone dev-delivery; do psql "$MIGRATION_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f db/seed/$f.sql; done
```

The roles are created by hand, with 0003's attributes (`LOGIN` alone), so they
carry passwords of their own; 0003's `CREATE ROLE … IF NOT EXISTS` then finds
them. Not `pnpm db:seed`: it starts with `dev-role-passwords.sql`, which would
set them to the shared dev passwords. CI is unaffected: one fresh database, no
`.env` at all.

## Database names

| Thing | Name |
|---|---|
| Database | `sufria` |
| Application roles | `sufria_dashboard`, `sufria_engine` — neither is superuser or BYPASSRLS |
| Migration role | `postgres` (owns the tables; the app never connects as it) |
| Migration ledger | `migrations.applied` (`name`, `applied_at`, `baselined`) — its own schema, out of `public`; no grant to the app roles |
| Test instance (local) | Postgres `16/test` on port 5434, its own roles and passwords; database `sufria_test`; URLs in `.env.test` (see *Commands*) |
| Docker container / volume | `sufria-postgres` / `sufria-pgdata` |

**`pnpm db:migrate` is safe on an existing database** (since brief I, 5 October
2026). `scripts/migrate.mjs` records every file it applies in
`migrations.applied`, **in the same transaction as the file** — each file's own
`BEGIN; … COMMIT;` (its first and last statements, refused otherwise) is
replaced by the runner's — so a file and its row commit together or not at
all, and a second run applies nothing. A database built before the ledger
(the demo restaurant's) is recorded up to `0012` as `baselined` — only once it
proves `0012` is there (`app.restaurants_with_unnotified_orders()`, SECURITY
DEFINER); a database that cannot prove it stops before any file, with nothing
changed. A session advisory lock keeps two runs apart. `tests/db/migrate.test.mjs`
(in `test:db`) holds all of it on databases of its own, created and dropped
per test — breaking the "applied?" check drops the second-run test.

🔴 **`pnpm db:reset` stays forbidden on the demo restaurant's database** — it
wipes it. A new migration reaches that database through `pnpm db:migrate` alone,
after a `pg_dump` to a file outside the repo (it holds customers' phones).

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
   `test:db` compares table and column *names* only — RLS policies, CHECK
   constraints, indexes, types and defaults are not checked. Review those by hand.
5. **`DATABASE_URL` must be `sufria_dashboard` (or `sufria_engine`), never
   `postgres`.** A superuser bypasses RLS with no error at all, so isolation checks
   pass without checking anything. `TenantDbService` refuses to start if it detects
   a superuser or BYPASSRLS role.
6. **`.env` never reaches git.** If it does, rotate every key — deleting the file
   does not remove it from history.

## Tests

All four packages run real suites — Jest for the backend apps, `node --test` for
`shared` and `dashboard-web`. The web tests guard the *decision*, not the code:
they fail if a status label is written inline, if a local status map or
`OrderStatus` type reappears, or if `preparing`/`completed` gain a customer
message. Since task G they also fail on **any** Arabic letter in the code of
`app/`, `features/` or `shared/` (every visible text comes from
`DASHBOARD_UI_AR` in `packages/shared/src/dashboard-ui.ts`), and on a local
copy of an API contract type; since task I, on an import that breaks the
structure (`test/boundaries.test.mts`). The screens' decisions — the card's
text, the pulse, what the next-step button sends and what a 409 leads to, the
details page's view, the cancel's body, `?next=` — live in
`features/orders/lib/` (`board.ts`, `details.ts`) and `features/auth/lib/`, as
plain TypeScript, because `node --test` cannot import JSX: components only
render what they return. The card's "the button does not open the order" is
held by reading the card's TSX and CSS (`test/orders/card.test.mts`): the
press itself needs a browser.

| Package | `test` script | Real? |
|---|---|---|
| `@sufria/dashboard-api` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/conversation-engine` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/shared` | `tsc -b && node --test "test/**/*.test.mts"` | yes |
| `@sufria/dashboard-web` | `tsc -b ../../packages/shared && node --test "test/**/*.test.mts"` | yes |

`shared` holds the pure half — the command matchers, the item parser, the cart
and order texts — so the parsing decisions are tested without a database, and
the engine suites are free to test only what needs one.

`conversation-engine/test/saving-sender.test.ts` covers the saving wrapper
(brief I, I-4): a send that went out leaves one row, a failed send or a text
over the limit none, a failed save neither throws nor logs the number, the row
is its restaurant's alone, the notifier names its order — and a reply sent
inside the inbound transaction arrives and is kept without hanging, while a
save blocked by a row lock gives up at 2 s. Breaks, each dropping only its
tests: saving before the send · letting a failed save throw · removing the 2 s
timeouts (the held-row test then takes 10 s, the pool's own timeout).
`dashboard-api/test/order-messages.test.ts` builds one customer's two orders
minute by minute (a «جاهز» of 101 sent mid-conversation for 102, an image that
anchors a reply, a message 25 h old, one after the last order, another customer,
the same digits at another restaurant). Breaks: ignoring `order_id` drops the
«جاهز» test; dropping the customer condition drops "another customer"; reading
`restaurant_id` from the raw header instead of the guard drops **nothing** —
on this route the guard verified that very header (no `restaurantId` param),
so the protection is the guard, held by `tenant-context.test.ts`.

**Jest, not Vitest, and never `tsx` — see `docs/ADR-004`.** Anything that boots
Nest DI must be compiled by a toolchain that emits `design:paramtypes`. esbuild
(so: `tsx`, and Vitest's default transform) drops it, and constructor injection
then resolves to `undefined` at runtime while `typecheck` and `lint` stay green.
ts-jest compiles with `tsc` itself, so the metadata survives.
`apps/dashboard-api/tsconfig.spec.json` restates `experimentalDecorators` and
`emitDecoratorMetadata` explicitly rather than inheriting them, and one test
asserts that injection actually resolved.

Both Jest suites need a live, seeded database (`pnpm db:migrate && pnpm db:seed`) —
they drive real HTTP requests through the real code and read the tenant context
back out of Postgres. Both run `--runInBand` with `PG_POOL_MAX=1` so the
connection-leak assertion is deterministic. Fixture ids come from
`db/seed/chain-isolation-fixture.sql`.

`dashboard-api/test/tenant-context.test.ts` covers the half `tests/security/`
cannot: that the **application** sets `app.current_restaurant_id`, per request,
only after `RestaurantContextGuard` verified membership, and never leaves it on
the pooled connection. The SQL gate sets that context by hand, so all twelve of
its assertions would still pass with the guard deleted.

`conversation-engine/test/conversation-session.test.ts` covers the reply half:
the business-hours gate, opening exactly one session, and the first outbound
message. It never calls Graph API — `WhatsAppSender` has a recording
implementation next to the real one, and both run the same length check, so a
test that passes against the fake means something about the real one. The clock
is injected, so "closes at 2:00 am" is written as a fixed fact instead of
something that depends on when the suite runs.

Two of its tests exist because deliberately breaking the code dropped too few:
breaking the active-session state filter dropped *zero* tests, so nothing
asserted that a customer who has ordered can start a new conversation. The
conflict-branch test is ordered rather than raced — it holds the winner's
transaction open — because a `Promise.all` race passes or fails depending on
machine load, which it did.

`conversation-engine/test/order.test.ts` guards the two decisions in task C that
no reading of the code would catch. **Post-COMMIT send:** the guard is a test
that forces the failure *at COMMIT* (a deferred constraint trigger), because a
failure forced earlier — the `order_status_history` trigger — fires before the
send is ever reached, so moving the send back inside the transaction drops
nothing. **The CAS:** ignoring its result while keeping `FOR UPDATE` writes two
orders for two concurrent «أكّد», verified by breaking it. That one has to be
concurrent *and ordered* — the winner holds its transaction open — because a
sequential double-send never reaches the handler at all: `findActiveSession`
already sees `order_placed`. `cart.test.ts`, `fulfillment.test.ts` and
`cart-review.test.ts` cover the states leading there.

`conversation-engine/test/webhook.test.ts` does the same for the inbound webhook,
which has no guard and no logged-in staff: the tenant comes from a
`phone_number_id`, so the test asserts the message lands under that restaurant
and nowhere else. It needs `ENGINE_DATABASE_URL` (role `sufria_engine`) and uses
`MIGRATION_DATABASE_URL` as a read-only audit connection — the only way to ask
"was a row written to some *other* tenant?", which cannot be asked from inside
RLS.

`conversation-engine/test/notifier.test.ts` covers the notification poller
(brief F §4). Four of its tests are guarded by breaking the code: building the
message from the listing instead of the claim's `RETURNING` drops only the race
test (7); dropping `AND notified = false` from the claim drops only the
two-pollers test (8); dropping the 24-hour window drops only test 11; letting
`pending_acceptance` speak drops only test 6. Test 8 uses two notifier
instances held at a barrier after both listed the order — a single instance
skips its own overlapping tick, and a plain `Promise.all` race passes or fails
by timing. Each notifier in the suite is scoped to the restaurants the test
created (`restaurantScope`, test-only).

`conversation-engine/test/session-timeout.test.ts` covers the session timeout
(brief H §3, tests 1–8, plus 9 for "idle time is the database's clock" and 10
for an expired session at a closed restaurant). A
session is aged with `UPDATE … last_message_at = now() - interval` from the
audit connection. Four breaks, each predicted before it ran: `>=` → `>` drops
only test 3; disabling the expiry step drops 1 and 4–10; letting the new session
copy the abandoned one's `context` drops only 5; measuring idle time with the
injected Node clock drops only 9. **The exact boundary is tested on the pure
`isSessionExpired`, not through the database**: the DB clock moves between
setup and check, so a session aged "60:00" is read at 60:00.05 and expires under
`>` too. Test 7 is ordered like the other concurrency tests — the winner holds
its transaction open, the loser blocks on the expiry CAS. `setup-env.ts` pins
`SESSION_IDLE_MINUTES=60`, so a temporary `1` in `.env` changes nothing here.

🔴 **Never count a whole table in a test** (`SELECT count(*) FROM orders`).
The engine and API suites run in parallel under `pnpm -r test`; count only the
rows of the order or restaurant the test itself created.

## Dashboard structure and the RTL contract (brief I §1–§2, 5 October)

`apps/dashboard-web` is feature-based (Mohammed's decision): `app/` holds the
routes and only composes · `features/auth/`, `features/orders/` — each with its
`components/`, `hooks/`, `api/`, `lib/` (pure functions) — · `shared/` (`ui/`,
`layout/` — the header, given its count as a prop — and `api/` — the client,
the token, `x-restaurant-id`, the error kinds). Tests in `test/<feature>/`.

1. `app/` composes: it imports from `features/` and `shared/`, with no logic.
2. **No feature imports another.** What two share belongs in `shared/`.
3. `shared/` imports neither `features/` nor `app/`.
4. Logic the API or the engine needs too lives in `packages/shared`.
5. A CSS module sits next to its component; no empty folders.

`test/boundaries.test.mts` fails on an import that breaks 1–3 (break: an
import of `features/auth` inside `features/orders` → caught, by file and line).

Routes: `/` → `/orders` or `/login` · `/login?next=` (a path of this site
alone: `//host`, `https://…`, a backslash or whitespace → `/orders`) ·
`/orders` · `/history` · `/orders/[id]` (`?from=history`). The dashboard pages
share `app/(dashboard)/layout.tsx`: the guard (no session, or a 401 the
refresh could not cure — the session store tells its subscribers — →
`/login?next=<page>`), the header, and **one** poll of «الطلبات» feeding both
the count and the list (`features/orders/hooks/live-orders.tsx`).

**The RTL and width contract, on every file touched** — from 375px to 1440px,
right to left by `dir="rtl"` on `<html>` alone, no horizontal scroll:
- DOM order = reading order = the phone's column. **Never** `row-reverse`,
  `column-reverse` or `order:` to fix a direction: `dir` already flips a row,
  and reversing it on top shows only once the row becomes a column.
- Logical properties only: `margin-inline-*`, `padding-inline-*`,
  `inset-inline-*`, `border-inline-*`, `text-align: start/end`,
  `border-start-start-radius`… — never `left`/`right` in any of them, `float`,
  or the same in `style={{}}` (`marginLeft`…).
- Space between elements is `gap`. Text that can grow inside flex or grid:
  `min-width: 0` and `…`, or a wrap on purpose.
- Numbers (`.num`, isolated), an amount with its currency, the masked number:
  `<bdi>` or `unicode-bidi: isolate`. The customer's words (messages, a
  cancellation reason, an address): `dir="auto"`.
- An icon with a direction mirrors (`:dir(rtl)`): «back» points right.
- **Breakpoints, fixed: 640** (the card: three rows below, one row from it up)
  **· 768 · 1024** (the details: one column below, two from it up) — written
  here and atop `globals.css`, because a CSS variable does not work in `@media`.
- A layout that changes with the width uses `grid-template-areas`, never
  `flex-wrap` and hope: the grid follows `dir`, the wrap follows text length.
- Touch targets 44px at every width.

`pnpm check:rtl` (`scripts/check-rtl.mjs`, in `verify` and a CI step) fails on
the first two items by file and line; a rare exception carries
`rtl-ok: <why>` on its line.

**The size budget (brief I-9b #5, Mohammed, 7 October).** `pnpm check:budget`
builds shared and the app (production, `NEXT_PUBLIC_API_URL` fixed so the
bytes do not move with a machine's `.env`), then `scripts/check-budget.mjs`
reads `.next` and counts, for `/login` · `/orders` · `/history` ·
`/orders/[id]`, what a browser loads before its first paint: the JS — Next's
root files plus the page's entry chunks (`build-manifest.json`,
`page_client-reference-manifest.js`), gzip, the `noModule` polyfills aside —
and the fonts next/font preloads for the page (`next-font-manifest.json`).
The manifests are checked against the static pages' HTML; a mismatch fails.
It fails when a page passes its numbers in `apps/dashboard-web/perf-budget.json`
— which only come down; up only by Mohammed's decision (`--write` resets
them). Not in `verify` or CI (a build). A server component's imports never
reach the browser and are not counted; a client component's are.

## Known gaps

- **`pnpm db:reset` assumes Docker and does nothing useful on a native
  PostgreSQL install.** It runs `docker compose down -v && pnpm db:up`, so
  against a native server on 5432 it tears down a volume nothing uses and then
  fails to bind the port. The native path — terminate connections, `DROP
  DATABASE sufria`, recreate it with the same locale (`TEMPLATE template0
  ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ar-JO' LOCALE 'C.UTF-8'`),
  then `pnpm db:migrate && pnpm db:seed` — is described in prose in
  `docs/02-تجهيز-البيئة.md` but is not automated anywhere. It no longer repeats
  on every new migration — `pnpm db:migrate` applies only the new file to an
  existing database — so it matters only for rebuilding a dev database, and
  never applies to the demo restaurant's.
- **Every mirror lives in `packages/shared`, and `pnpm test:db` now enforces
  that.** It used to iterate the TS schema only, so a SQL table mirrored
  somewhere else was invisible to it — `inbound_messages` sat in
  `apps/conversation-engine/src/db/schema.ts` and went unchecked. That mirror
  moved into `packages/shared`, and the drift check now also walks the
  database's own table list, so a table mirrored nowhere is a failure rather
  than a silent gap. Put new mirrors in `packages/shared`; anywhere else fails.
- `@sufria/conversation-engine` now carries a conversation from the first
  message to a row in `orders`. One handler per state, each the same shape — a
  pure decision plus a thin I/O shell — and the state is only ever in the
  session row:
  `browsing` (`conversation/browsing.ts`) · `fulfillment_choice`
  (`conversation/fulfillment.ts`, two steps in one enum value) · `cart_review`
  (`conversation/cart-review.ts`) · order creation
  (`conversation/order-creation.ts`). Briefs: `docs/11-cart-brief.md` and
  `docs/12-after-cart-brief.md`.
  Writing a new `menu_map` re-checks every cart line's availability live and
  drops what is gone — **the criterion is `is_available`, never absence from
  `menu_map`**, which is authority over numbering alone (cart brief §16). Order
  creation re-checks it again inside its own transaction (cart brief §16.6): a cart can sit
  for minutes, and «منيو» may never come twice.
- **The customer's «استلمنا طلبك» is sent after COMMIT, never inside the
  transaction.** Handlers push onto `ConversationContext.deferred` and whoever
  owns the transaction drains it with `flushDeferred` once it succeeds; a send
  that fails there is logged and the order is left alone. Sending first would
  hand the customer a confirmation for an order that may never be written — and
  a sent WhatsApp message does not roll back. The field is mandatory on purpose:
  an optional one gets forgotten silently, and the customer then orders and
  hears nothing, with no test failing. A test that forces the failure at COMMIT
  (a deferred constraint trigger) is the one that guards this; forcing it
  earlier proves nothing, because the send is never reached.
- **Every state transition is a CAS, and the row lock does not substitute for
  it.** `readSessionData` takes `FOR UPDATE`, but it reads `context` only — the
  state that routed the message was read before the lock, in
  `findActiveSession`. Drop the CAS and two concurrent «أكّد» write two orders;
  verified by breaking it. A *sequential* double-send proves nothing here, since
  routing alone stops the second one.
- **`orders.notified` is written `true` at creation, against its default.**
  `false` means "the poller must send" — the notify loop is part هـ of blueprint
  §6.4, and `idx_orders_unnotified` is built for it — and the engine already sent
  the message itself.
  Deviation recorded in `docs/12-after-cart-brief.md` §12. The poller sends
  nothing for an order in `pending_acceptance` — `statusNotificationAr` returns
  `null` for it, and test 6 of `notifier.test.ts` guards it.
- **`business_hours` has no schema in the database — its contract is
  `docs/10-عقد-ساعات-الدوام.md`.** Migration 0001 declared the column and
  nothing ever wrote a shape into it; the shape is still defined by
  `apps/conversation-engine/src/restaurant/business-hours.ts`, but it is now
  written down for the settings screen instead of being folklore.
  The shape is `{days: {sun: [{open, close}]}}` — **the timezone is no longer
  in it.** Migration 0008 moved it to a real `restaurants.timezone` column,
  backfilled it and stripped the key from every row; a `timezone` key that
  reappears in the jsonb is ignored and logged as a warning. The old rationale
  recorded here — that a new column on `restaurants` would be a schema-drift
  failure — was simply wrong: drift fails when SQL changes and the mirror does
  not, and changing both together is what the check is for. 0007 already said
  so in its own header.
- **A malformed `business_hours` reads as open, not closed.** Deliberate: a
  restaurant that silently stops taking orders because of a broken jsonb loses
  money without knowing, while one that receives a message out of hours sees it
  and acts. The empty field is "always open" by product decision; malformed gets
  the same treatment plus an error log.
  **The dashboard therefore writes the canonical shape alone** (brief D §8.8:
  strict writer, lenient reader): all seven short day keys in every PATCH, a
  closed day as `[]`, `"HH:MM"` with two digits. A week in which the engine
  recognises no day — `{}`, numeric keys, `{from, to}` windows — reads as always
  open, so a near-miss shape makes a closed restaurant take orders, silently.
  - **The 0008 backfill branch has never actually run.** Every seeded row had
  `business_hours = {}`, so the `UPDATE` matched zero rows: the SQL passed, but its
  behaviour on a row that really carries a legacy `timezone` key is unverified.
  No production database exists, so nothing is at risk today. If a legacy database
  ever appears, check it by hand before migrating.
- **`order_placed` is a closed state, so the next message opens a brand-new
  session and the customer gets the whole menu again.** There is no "your order
  is on its way" reply and no way to ask about an order that was just placed.
  Deliberate for now — recorded as a product decision for Mohammed before the
  pilot (`docs/12-after-cart-brief.md` §16.8), not as a bug to fix in code.
- **An active session silent for `SESSION_IDLE_MINUTES` (default 60) or more
  expires lazily, when the next message arrives** (brief H). `handleInbound`
  reads the idle time with the session (`now() - last_message_at`, the
  database's clock), CASes the row to `abandoned` on the state it read, and
  the message continues down the new-session path unchanged — hours gate,
  welcome and menu, empty cart. The old row keeps its `context` and
  `last_message_at`; only `state` changes, which is why this is not
  `advanceSessionState` (it rewrites the timestamp). There is no background
  job: a silent session stays in its state until its customer writes again.
  Consequences worth knowing: an expired session at a **closed** restaurant is
  abandoned and gets the closing text, with no session after it; the timestamp
  is *written* from the Node clock (the injected `now`, or `new Date()` in
  `advanceSessionState`) but *read* against the database's, so the two hosts'
  clocks must agree to within seconds; and two messages straddling the exact
  60:00 mark can let the late one abandon a session the early one just touched
  — the CAS checks the state, not the timestamp, as the brief specified.
- **A status change reaches the customer through the poller, at most once.**
  `PATCH /orders/:id/status` sets `notified = false` and sends nothing; the
  engine's `OrderNotifier` (`src/notify/order-notifier.ts`, brief F) picks it
  up every `NOTIFY_POLL_MS` (default `5000`, `0` turns it off, off in tests) and
  sends one message by status — or none, when silence is the decision
  (`preparing`, `completed`). The claim is `UPDATE … SET notified = true WHERE
  notified = false RETURNING` and the message is built from that row only. It
  commits **before** the send: a crash in between loses the message, by design
  (a duplicate is worse). A failed send is retried twice (2 s, 6 s) and then
  logged at `error` — `notified` stays `true`. Orders older than 23h50m are
  marked without sending: free-form messages need the 24-hour window and there
  are no approved templates. Two statuses between ticks send only the last.
  The engine has no tenant context here, so it lists restaurants through
  `app.restaurants_with_unnotified_orders()` (0012, Bypass #4: `SETOF uuid`,
  `sufria_engine` alone, gate A13–A15) and does everything else in
  `runInTenant`.
- **Nothing updates the customer's statistics on `completed`.** `total_orders`,
  `total_spend`, `last_order_at` and `is_vip` keep their defaults: no code and
  no trigger writes them. SRS FR-14 via FR-13; found in D-7, **undecided** —
  a product call for Mohammed, not a bug to fix in passing.
- **The customer's menu order is written twice** — the ORDER BY in the engine's
  `readMenu` and in `dashboard-api`'s `MenuService` (`customerOrder()`, used by
  the list and by the 4096 guard's read). Changing one does not fail the
  other. The guard's *length* does not depend on it (the categories stay
  contiguous either way); the screen's order does.
- **Every text the engine sends is kept in `outbound_messages` (0013), from the
  day it shipped — nothing before it.** One wrapper, `SavingWhatsAppSender`
  (`src/whatsapp/saving-sender.ts`, built in `main.ts`): after a successful
  send, on a `TenantDb` of its own (most replies leave inside the inbound
  transaction, which holds a connection of the engine's pool), with
  `lock_timeout` and `statement_timeout` at 2 s; a failed save is an `error`
  line with the number masked, never a failed reply. `orderId` is set by the
  status notifier alone: no message sent while a transaction is open carries
  one — that transaction's rows are not there for the wrapper's connection —
  and «استلمنا…», sent after COMMIT, carries none either, by Mohammed's
  decision (5 October). `GET /orders/:id/messages` attributes such messages by
  the customer's last message before them. The rules, as built:
  `docs/13-dashboard-api-brief.md` §9.9.
- **The security gate's negative control 2 alters an application role.**
  `tests/security/negative-controls.sh` runs `ALTER ROLE sufria_dashboard
  SUPERUSER` and then `NOSUPERUSER`; roles belong to the Postgres instance, and
  nothing restores the role if the script dies in between. Locally that is the
  test instance's role now (5434, Mohammed's option B, 5 October); in CI it is a
  throwaway instance. **For a later brief, not done (option C):** make the
  control grant SUPERUSER to a role it creates for the run, so the gate never
  alters an application role on any instance.
- **`pnpm -r test` kills the other packages' suites when one fails** (it bails
  on the first failure), so their `afterAll` never runs and their fixtures
  stay in the database — `menu-items.test.ts`'s fixed-id categories then make
  the next run fail on a duplicate key. Found in brief I (5 October): delete
  the leftovers by the killed run's id (`d5-<pid>-<time>` in their names), as
  the test's own `afterAll` would — and never the seed's (`both@`, `onlya@`,
  `onlyz@sufria.test`).
- **A failed «استلمنا طلبك» is never retried.** It is logged, and the order is
  already in the dashboard, so the restaurant still sees it — but the customer
  gets silence after «أكّد». The notify poller does not retry it either: the
  order is written `notified = true`, so the poller never sees it.
- **A closed restaurant answers every message with the closing text.** No session
  is opened by design, so nothing remembers that the customer was already told.
  Rate-limiting that repeat belongs with the state machine.
- **The menu is sent whole, in one message.** A menu that exceeds WhatsApp's
  4096-character limit is detected, logged as an error and *not* sent — never
  truncated — and no session is opened, so it recovers by itself once the menu
  is shortened. Paging the menu, or a category-selection step, is a deliberate
  deferral. Since brief ي-أ the dashboard cannot make it too long (the 4096
  guard, below); the engine's check stays the net for a menu written any other
  way.
- **The menu's message is built in `packages/shared`** (`menu-message.ts`,
  brief ي-أ §3): `renderMenuText`, `firstMenuMessageAr` (welcome + `"\n"` +
  menu), `WHATSAPP_TEXT_LIMIT` and `whatsappTextLength` (`[...body].length`).
  The engine sends it, and the API's guard measures it, with the same
  functions. Its every character is pinned by
  `conversation-engine/test/menu-snapshot.test.ts`, which asks `handleInbound`
  on a real database and compares with `test/fixtures/menu-snapshot/*.txt` —
  generated from the engine's code before the move, and untouched by it.
  Changing the text on purpose means regenerating those fixtures in the same
  commit.
- **Orders can be paused** (`restaurants.orders_paused_at`, 0014; brief ي-أ,
  Mohammed's decisions 1–3). While set, every message gets
  `ORDERS_PAUSED_AR`, the one text, and nothing is written. The order in
  `handleInbound`: the session timeout (H) → **an active session while
  paused: the text, before any routing** — «أكّد» included, so no order; the
  session untouched, not even `last_message_at` → routing → the hours gate
  (closed beats paused for a new conversation: its text carries the hours) →
  **a new conversation while paused: the text, no session** → `prepareMenu`.
  One `info` line per such reply: restaurant, `reason` (`paused` or
  `empty_menu`), number masked. Written by `PATCH /restaurant/orders-pause`
  (pausing again keeps the first moment); read with every message, so it
  applies from the next one.
- **A menu with no item to show is the paused text** (decision 3), by the
  menu's own criterion — no line came back from `readMenu` (an available item
  in an active category), never a second count. A new conversation gets
  `ORDERS_PAUSED_AR` and no session (`empty_menu`); «منيو» in a session gets
  it too, and the session is not written — the menu is now prepared before
  the session write, so the cart is not pruned either.
- **Archiving is a constraint, not engine code.** `menu_items.archived_at`
  (0014) with `CHECK (archived_at IS NULL OR is_available = false)`: an
  archived item is never available, so every engine path that reads
  `is_available` — the menu, every add, every new `menu_map`, the «أكّد»
  re-check — treats it as a switched-off one, and no engine line knows the
  column exists. «Removed from the menu» is archived, never deleted
  (decision 4); `archived: false` brings it back switched off. The API turns
  any change to an archived item but `archived: false` into a 409
  `item_archived` — the constraint's own refusal included, never a 500.
- **The 4096 guard** (`dashboard-api`, `MenuService.guarded`; brief ي-أ §5).
  On `POST /menu-items`, a `PATCH` with `name`, `price` or
  `isAvailable: true`, and `enable-all`: inside the change's own transaction,
  the first message — the welcome with the restaurant's name, and the menu —
  is built before and after from the database with the shared functions and
  counted as WhatsApp counts; **longer than 4096 and longer than before** →
  rollback and a 409 `menu_too_long` with `length` and `limit`. «Longer than
  before» lets a menu already too long (the setup script does not check)
  take any change that does not lengthen it, and recover by shortening.
- **A pause saved in the very millisecond «أكّد» writes its order can let that
  one order through.** The engine reads `orders_paused_at` at the start of the
  message's transaction; a pause committed after that read does not stop it.
  Known and accepted (brief ي-أ §4) — no lock was added for it.
- **Two menu edits committed at the same moment can each pass the 4096 guard
  and pass it together.** Each transaction measures its own change, not the
  other's uncommitted one; no lock serialises menu edits, in the spirit of the
  pause race above. The engine's check still refuses to send such a menu, and
  the next edit that shortens it is accepted.
- **The setup script does not check the 4096 limit** (brief ي-أ §9: out of
  scope). A menu file can still produce a first message the engine refuses to
  send; the guard then accepts every edit that shortens it.
- **A pause longer than `SESSION_IDLE_MINUTES` ends the sessions of customers
  who write during it.** The paused reply does not touch `last_message_at`
  (decision 1) and the timeout runs first (H), so a customer whose last
  message before the pause is over an hour old gets their session abandoned
  — the cart stays in that row — and, once orders resume, starts over with
  the menu. Both rules are the briefs'; this is what they add up to.
- **A split shift shows only its first window** in the closing message: the text
  has two slots, not four. Showing the *next* window would be a computed promise,
  which is the thing that text deliberately avoids.
- **Per-restaurant message text (`message_templates`) is deferred, not rejected.**
  The table exists since 0001 with `restaurant_id NULL` meaning a platform
  default, but nothing reads it. Customer-facing Arabic lives in
  `packages/shared/src/domain.ts` instead. Letting each restaurant edit its own
  wording is not needed in Sprint 1 or 2, costs a read per message and a
  migration per wording change, and works against the decision that the
  templates keep one voice that suits both an upmarket restaurant and a shawarma
  counter.

---

## قبل أي سطر كود — قواعد قراءة البريف

🔴 **أي جملة في أي بريف تصف هذا الريبو — ملف موجود، دالة موجودة، عمود موجود،
مسار كذا — هي افتراض من كاتب البريف، لا حقيقة.** تحقّق منها بنفسك أولا.

🔴 **إذا خالف الواقعُ البريفَ: قف واذكر الفرق.** لا تكمّل على أيهما، ولا تُصلح
البريف ضمنا.

🔴 **إذا تعارضت تعليمتان في البريف: قف واسأل.** لا تختر واحدة بنفسك.
حصل ثلاث مرات في يوم واحد: (١) «اختبارات حقيقية» مع «ممنوع dependencies»،
(٢) مسار مخالف لوثيقة Sprint 1، (٣) «النصوص من shared» مع «ممنوع تضيف فيها».

🔴 **إذا كان سؤالك التقني يخفي خلفه قرار منتج أو معمارية — سمِّ القرار صراحة
في سؤالك.** ثلاثة قرارات كادت تُتخذ ضمنا داخل أسئلة صياغة: نص مرقّم مقابل قائمة
تفاعلية · وقت محسوب مقابل حقيقة مخزّنة · سلوك القائمة الطويلة.

🔴 **النصوص العربية الظاهرة للمستخدم لا تُخترع ولا يُعاد صياغتها.** تُطلب من
محمد حرفيا، وتُنسخ كما هي.

## ملكية الموارد — يحدّدها كل بريف صراحة

`pnpm-lock.yaml` · `package.json` · `packages/shared` · رقم الهجرة التالي.
**البريف الذي لا يحدّدها يُسأل عنها قبل البدء، لا يُفترض.**

---

## شروط الإنجاز — إلزامية لكل مهمة

المهمة لا تُحتسب منجزة إلا إذا:
1. الشغل مكوَّم ومدموج على `main` **ومرفوع على `origin/main`**. لا يُترك في worktree.
2. الـworktree الذي عملتَ فيه منشطوب.
3. `pnpm -r test` يمر على `main` نفسها بعد الدمج.
4. أي سكربت اختبار كان `echo` وله علاقة بشغلك يُستبدل باختبار حقيقي.
5. في آخر ردك، الصق ناتج هذه الأوامر حرفيا وبلا تلخيص:
   `git worktree list && git status --short && git log --oneline -3 && pnpm -r test 2>&1 | tail -15`

🔴 **كوميت بعد كل بند ينجح اختباره — لا تجميع للنهاية.**
ضاعت محاولة كاملة: امتلأ القرص أثناء استعادة المصادر بعد اختبار الكسر، فمُسح 13 ملفا
وكلها كانت غير مكوَّمة. الكوميت المؤقت رخيص، والجلسة المعلّقة تأخذ كل غير المكوَّم معها.

🔴 **لا تشغّل اختبارات قاعدة البيانات بالتوازي مع جلسة أخرى.**
بعضها يأخذ `ACCESS EXCLUSIVE`، والتوازي = تعليق أبدي بلا رسالة خطأ.

🔴 **تحقّق من المساحة قبل البدء: `df -h /`**
والقرص الذي يمتلئ على WSL هو قرص ويندوز المضيف، لا لينكس — والعرَض `Input/output error`.

🔴 **تقرير الوكيل عن نفسه ليس دليلا. الدليل الوحيد ناتج أمر على `main`.**
حصل ثلاث مرات: رينيم Sufria، وB0، وتقوية المستقبِل — كلها كانت "خالصة" وهي غير مكوَّمة،
والتقارير كانت دقيقة وصحيحة، والشغل لم يكن على `main`.

## قرارات مقفولة — لا تُعاد مناقشتها

- 🔴 **الاختبارات على اللاب دايما بـ`.env.test` — ممنوع تشغيلها بدونه.** `.env` بيأشّر على قاعدة مطعم
  العرض الحقيقية، و`.env.test` على نسخة Postgres الاختبارات (منفذ 5434) بأدوارها وكلمات سرها
  (قرار محمد، 5 أكتوبر). الأمر: `set -a && . ./.env.test && set +a && pnpm verify`.

- **Drizzle** (ADR-001) · **Zod** (ADR-003)
- **Jest + ts-jest** — لا Vitest ولا esbuild ولا SWC (ADR-004).
  السبب: esbuild لا يدعم `emitDecoratorMetadata`، وNest يقرأ `design:paramtypes`
  للحقن بالنوع. بدونه **الحقن يصير `undefined` بصمت** — وقد حصل فعلا.
- **Meta Cloud API مباشرة** — لا BSP ولا 360dialog.
- **الهجرات إضافة فقط.** ممنوع تعديل هجرة مطبَّقة. أي تغيير بهجرة جديدة.
- **الأرقام غربية فقط** (0-9). ممنوع الخلط. البوابة `pnpm check:numerals` (`scripts/check-numerals.mjs`،
  جزء من `pnpm verify` وخطوة CI): كل نص مصدَّر من `@sufria/shared` وكل ملف مكتوب باليد في `dashboard-web`.
  **لا تفحص** مصدر `shared` نفسه — `normalize.ts` يحمل `٠-٩` بقصد لتطبيع مدخلات الزبون. ما عدا ذلك
  (المحرّك، الـAPI): افحص يدويا.
- **الخطوط:** IBM Plex Sans Arabic للنص · IBM Plex Mono للأرقام. Almarai مشطوب.
  أوزانها وpreload وطريقة تحميلها قرار تصميم مع محمد — ولا تغيير بلاه (بريف ط-9ب).
- **قاعدة الأداء — قرار محمد، 7 أكتوبر (بريف ط-9ب §3):**

  | نوع الصفحة | الهدف |
  |---|---|
  | **الصفحات العامة** (الموقع، وصفحة «منيو برابط» إذا انبنت) | Lighthouse **100** تلفون ولابتوب |
  | **تحميل اللوحة** (ومنها `/login`) | تلفون **≥ 90** · لابتوب **≥ 95** هلق، و**100** بعد الاستضافة |
  | **تفاعل اللوحة** | **INP ≤ 200ms** على معالج ×4 للأفعال الأساسية |
  | **كل الصفحات** | **حد حجم ثابت** (`check:budget`): ما بيطلع، وكل تحسين بينزّله |

  **مؤجّل للاستضافة:** الـAPI على نفس الدومين (بيشيل طلب الـpreflight) · الجلسة بكوكي httpOnly عشان
  السيرفر يرسم البيانات (أداء وأمان). 🔴 ممنوع الحيل: أي تعديل بيرفع الرقم بلا ما يحسّن إشي حقيقي.
- **لون البراند:** سُمّاق `#75284A` فاتح / `#B54874` غامق. الألوان كلها في `packages/shared/src/design-tokens.ts`
  وحده، ومنه تتولّد متغيّرات CSS. البوابة `pnpm check:contrast` (جزء من `pnpm verify` وخطوة CI) تعدّد الأزواج
  منه — كل نص فوق كل خلفية يقع عليها، وكل شارة، بالوضعين — بحدّ 4.5:1.
  🔴 `text-muted` (فاتح) و`accent` (غامق) **ليسا لونَي نص**: 3.23:1 و3.26:1.
- **قاعدة رد الـwebhook — لا تُعكس أبدا:**
  `200` = خُزّنت بأمان، أو تُجوهلت بقصد ونهائيا (JSON مشوّه، نوع غير مدعوم).
  **غير `200`** = لم أستطع — أعِد الإرسال.
  ميتا تعيد الإرسال بتردد متناقص **حتى 7 أيام** على أي رد غير `200`، فهي طابور
  إعادة مجاني. الرد بـ`200` على فشل تخزين يضيّع رسالة زبون **نهائيا**.
  ممنوع الرجوع إلى «200 دائما».
- **`/health` يلمس قاعدة البيانات.** بدونه تبقى عملية بقاعدة واقعة "سليمة"
  وتبلع كل الرسائل وترد `200`.
- **مسار المستقبِل `/webhooks/whatsapp`** — لا `/webhook`.
- **المنيو واختيار الأصناف: نص مرقّم، لا قائمة تفاعلية (Interactive List).**
  حدّان صلبان من ميتا: 10 صفوف إجمالا و24 حرفا لعنوان الصف — أي منيو حقيقي يكسرهما.
  والأهم منتجيا: النص الحر يسمح بـ«2 و5» و«شاورما ×2 بدون بصل» — وهو ما لا تستطيع
  القائمة التفاعلية التعبير عنه إطلاقا. هذا ما يجعل السلّة ممكنة أصلا.
  **غير مشمول:** الاختيارات القصيرة (أكّد/عدّل/ألغِ · توصيل أم استلام · طريقة الدفع)
  — قرار منفصل لم يُتخذ بعد، وReply Buttons (3 كحد أقصى) مرشّح واقعي هناك.
  **ما يعيد فتحه:** أن يفشل زبائن البايلوت فعليا في الرد برقم.

## مصائد ممنوع فتحها

- **إعادة توليد مخططات `.png`** — `mmdc` يجرّ Puppeteer/Chromium ويفشل على WSL. مصيدة وقت مسجّلة.

🔴 **سكربت اختبار الكسر يسترجع الملف المكسور وحده — ممنوع `git checkout -- .` وممنوع `git checkout HEAD -- .`**
مسح تعديلات غير مكوَّمة فعلا. وتكرّر اليوم: وكيل استعمل `HEAD -- .` لأن القاعدة لم تكن مكوَّمة، فلم يرها الـworktree تبعه.

## أسلوب العمل

- اشرح الفكرة بلغة بسيطة **قبل** الأمر · أمر واحد كل مرة · اختصر.
- **تحقّق قبل أن تقول.** إذا لم تستطع، قل «غير متحقَّق منه» صراحة.
- لا تقدّم استنتاجا بثقة حقيقة متحقَّق منها.
