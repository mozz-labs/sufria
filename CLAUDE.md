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
| `apps/dashboard-api` | `@sufria/dashboard-api` | NestJS REST API for the restaurant dashboard: orders and their status, menu-item price and availability, restaurant settings (task D). Contracts as built: `docs/13-dashboard-api-brief.md` §9 |
| `apps/conversation-engine` | `@sufria/conversation-engine` | WhatsApp webhooks, business-hours gate, session, browsing cart, pickup-or-delivery, address, and order creation (task C); the customer-notification poller (task F, `src/notify/`) |
| `apps/dashboard-web` | `@sufria/dashboard-web` | Next.js staff UI: login and the orders screen (task G, `docs/16-orders-screen-brief.md`). Talks to `dashboard-api` at `NEXT_PUBLIC_API_URL` |
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
pnpm verify           # format:check + lint + typecheck + test — run before any push
pnpm --filter @sufria/dashboard-web dev    # single package
# Dev only, never a real restaurant: change an order's status through the API,
# as the dashboard button will (brief F §5). Needs DEMO_STAFF_EMAIL/PASSWORD in .env:
node --env-file=.env scripts/demo-order-status.mjs 101 accepted
```

`pnpm verify` needs a live database: `test:security` and `test:db` connect using
`DATABASE_URL` / `MIGRATION_DATABASE_URL` from `.env` (copy `.env.example`).

## Database names

| Thing | Name |
|---|---|
| Database | `sufria` |
| Application roles | `sufria_dashboard`, `sufria_engine` — neither is superuser or BYPASSRLS |
| Migration role | `postgres` (owns the tables; the app never connects as it) |
| Migration ledger | `migrations.applied` (`name`, `applied_at`, `baselined`) — its own schema, out of `public`; no grant to the app roles |
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
`app/` or `lib/` (every visible text comes from `DASHBOARD_UI_AR` in
`packages/shared/src/dashboard-ui.ts`), and on a local copy of an API
contract type. The screen's decisions — the card's text, the pulse, what the
next-step button sends and what a 409 leads to — live in
`apps/dashboard-web/lib/board.ts`, as plain TypeScript, because `node --test`
cannot import JSX: components only render what it returns.

| Package | `test` script | Real? |
|---|---|---|
| `@sufria/dashboard-api` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/conversation-engine` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/shared` | `tsc -b && node --test "test/**/*.test.mts"` | yes |
| `@sufria/dashboard-web` | `tsc -b ../../packages/shared && node --test "test/**/*.test.mts"` | yes |

`shared` holds the pure half — the command matchers, the item parser, the cart
and order texts — so the parsing decisions are tested without a database, and
the engine suites are free to test only what needs one.

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

🔴 **Never count a whole table in a test** (`SELECT count(*) FROM orders`).
The engine and API suites run in parallel under `pnpm -r test`; count only the
rows of the order or restaurant the test itself created.

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
  `readMenu` and in `dashboard-api`'s `MenuService.list`. Changing one does not
  fail the other.
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
  deferral.
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
