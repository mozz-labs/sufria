# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Sufria — a WhatsApp-first direct-ordering platform for restaurants. WhatsApp is the
first channel, not the product.
ا
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
| `apps/conversation-engine` | `@sufria/conversation-engine` | WhatsApp webhooks, business-hours gate, session + first reply (order state machine not built yet) |
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
   (coverage is not complete — see Known gaps)
5. **`DATABASE_URL` must be `sufria_dashboard` (or `sufria_engine`), never
   `postgres`.** A superuser bypasses RLS with no error at all, so isolation checks
   pass without checking anything. `TenantDbService` refuses to start if it detects
   a superuser or BYPASSRLS role.
6. **`.env` never reaches git.** If it does, rotate every key — deleting the file
   does not remove it from history.

## Tests

All three packages run real suites — Jest for the backend apps, `node --test` for
`dashboard-web`. The web tests guard the *decision*, not the code: they fail if a
status label is written inline, if a local status map or `OrderStatus` type
reappears, or if `preparing`/`completed` gain a customer message.

| Package | `test` script | Real? |
|---|---|---|
| `@sufria/dashboard-api` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/conversation-engine` | `jest --config jest.config.json --runInBand` | yes |
| `@sufria/dashboard-web` | `tsc -b ../../packages/shared && node --test "test/**/*.test.mts"` | yes |

**Jest, not Vitest, and never `tsx` — see `docs/ADR-004`.** Anything that boots
Nest DI must be compiled by a toolchain that emits `design:paramtypes`. esbuild
(so: `tsx`, and Vitest's default transform) drops it, and constructor injection
then resolves to `undefined` at runtime while `typecheck` and `lint` stay green.
ts-jest compiles with `tsc` itself, so the metadata survives.
`apps/dashboard-api/tsconfig.spec.json` restates `experimentalDecorators` and
`emitDecoratorMetadata` explicitly rather than inheriting them, and one test
asserts that injection actually resolved.

Both suites need a live, seeded database (`pnpm db:migrate && pnpm db:seed`) —
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

`conversation-engine/test/webhook.test.ts` does the same for the inbound webhook,
which has no guard and no logged-in staff: the tenant comes from a
`phone_number_id`, so the test asserts the message lands under that restaurant
and nowhere else. It needs `ENGINE_DATABASE_URL` (role `sufria_engine`) and uses
`MIGRATION_DATABASE_URL` as a read-only audit connection — the only way to ask
"was a row written to some *other* tenant?", which cannot be asked from inside
RLS.

## Known gaps


- **`pnpm db:reset` assumes Docker and does nothing useful on a native
  PostgreSQL install.** It runs `docker compose down -v && pnpm db:up`, so
  against a native server on 5432 it tears down a volume nothing uses and then
  fails to bind the port. The native path — terminate connections, `DROP
  DATABASE sufria`, recreate it with the same locale (`TEMPLATE template0
  ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'ar-JO' LOCALE 'C.UTF-8'`),
  then `pnpm db:migrate && pnpm db:seed` — is described in prose in
  `docs/02-تجهيز-البيئة.md` but is not automated anywhere. Since migrations only
  ever run against a clean database, this friction repeats on **every** new
  migration. A `db:reset:native` script would remove it.

- **Every mirror lives in `packages/shared`, and `pnpm test:db` now enforces
  that.** It used to iterate the TS schema only, so a SQL table mirrored
  somewhere else was invisible to it — `inbound_messages` sat in
  `apps/conversation-engine/src/db/schema.ts` and went unchecked. That mirror
  moved into `packages/shared`, and the drift check now also walks the
  database's own table list, so a table mirrored nowhere is a failure rather
  than a silent gap. Put new mirrors in `packages/shared`; anywhere else fails.
- `@sufria/conversation-engine` now dedupes, routes, stores, applies the
  business-hours gate, opens a conversation session and sends the first reply.
  There is still **no order state machine**: a message from a customer who
  already has an active session only refreshes `last_message_at`. No cart, no
  address, no payment, no order creation.
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
- **الأرقام غربية فقط** (0-9)، بوابة `check:numerals`. ممنوع الخلط.
- **الخطوط:** IBM Plex Sans Arabic للنص · IBM Plex Mono للأرقام. Almarai مشطوب.
- **لون البراند:** سُمّاق `#75284A` فاتح / `#B54874` غامق. بعد أي تبديل: `pnpm check:contrast`.
- **قاعدة رد الـwebhook — لا تُعكس أبدا:**
  `200` = خُزّنت بأمان، أو تُجوهلت بقصد ونهائيا (JSON مشوّه، نوع غير مدعوم).
  **غير `200`** = لم أستطع — أعِد الإرسال.
  ميتا تعيد الإرسال بتردد متناقص **حتى 7 أيام** على أي رد غير `200`، فهي طابور
  إعادة مجاني. الرد بـ`200` على فشل تخزين يضيّع رسالة زبون **نهائيا**.
  ممنوع الرجوع إلى «200 دائما».
- **`/health` يلمس قاعدة البيانات.** بدونه تبقى عملية بقاعدة واقعة "سليمة"
  وتبلع كل الرسائل وترد `200`.
- **مسار المستقبِل `/webhooks/whatsapp`** — لا `/webhook`.

## مصائد ممنوع فتحها

- **إعادة توليد مخططات `.png`** — `mmdc` يجرّ Puppeteer/Chromium ويفشل على WSL. مصيدة وقت مسجّلة.

🔴 **سكربت اختبار الكسر يسترجع الملف المكسور وحده — ممنوع `git checkout -- .`**

(مسح تعديلات غير مكوَّمة فعلا.)

## أسلوب العمل

- اشرح الفكرة بلغة بسيطة **قبل** الأمر · أمر واحد كل مرة · اختصر.
- **تحقّق قبل أن تقول.** إذا لم تستطع، قل «غير متحقَّق منه» صراحة.
- لا تقدّم استنتاجا بثقة حقيقة متحقَّق منها.
