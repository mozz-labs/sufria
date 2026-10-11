const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak,
  ImageRun, LevelFormat, convertInchesToTwip, PageOrientation, Footer, PageNumber,
} = require('docx');

// Chapter 3 is generated, never edited as a .docx: change this script,
// stories.json or a diagram source, then run `node docs/diagrams/build-ch3.js`.
const STORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'stories.json'), 'utf8'));
const DIA = __dirname;
const OUT = path.join(__dirname, '..', 'Sufria_Chapter3_System_Design_v1.2.docx');
const ACCENT = '1F4E5F';
const GREY = 'F2F2F0';

const png = (n) => fs.readFileSync(path.join(DIA, `${n}.png`));
const dims = (n) => {
  const d = png(n).subarray(16, 24);
  return { w: d.readUInt32BE(0), h: d.readUInt32BE(4) };
};

// At 96 dpi, inside 1100-twip margins on A4: portrait 630 × 800 px;
// landscape 976 px wide, and 470 px tall so a heading and a paragraph fit
// on the same page as the figure.
const FIT = {
  portrait: { w: 630, h: 800 },
  landscape: { w: 976, h: 470 },
  landscapeShort: { w: 976, h: 400 },   // with an H1, an H2 and a paragraph on the page
  landscapeAlone: { w: 976, h: 600 },   // a figure and its caption, nothing else
};

let figNo = 0;
const figure = (name, caption, fit = FIT.portrait) => {
  const { w, h } = dims(name);
  const s = Math.min(fit.w / w, fit.h / h);
  figNo++;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 160, after: 60 },
      children: [new ImageRun({ type: 'png', data: png(name), transformation: { width: Math.round(w * s), height: Math.round(h * s) } })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 220 },
      children: [new TextRun({ text: `Figure 3.${figNo} — ${caption}`, italics: true, size: 18, color: '5A5A57', font: 'Calibri' })],
    }),
  ];
};

const P = (t, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 120, line: 276 }, alignment: o.align, keepNext: o.keepNext,
  children: [new TextRun({ text: t, bold: o.bold, italics: o.italics, size: o.size ?? 21, font: 'Calibri' })],
});
const Rich = (runs) => new Paragraph({
  spacing: { after: 120, line: 276 },
  children: runs.map(r => new TextRun({ ...r, size: r.size ?? 21, font: 'Calibri' })),
});
const H = (t, lv) => new Paragraph({
  heading: lv, keepNext: true, spacing: { before: 300, after: 140 },
  children: [new TextRun({ text: t, bold: true, color: ACCENT, font: 'Calibri' })],
});
const BULLET = (t) => new Paragraph({
  numbering: { reference: 'b', level: 0 }, spacing: { after: 70, line: 276 },
  children: [new TextRun({ text: t, size: 21, font: 'Calibri' })],
});
const cell = (t, o = {}) => new TableCell({
  width: { size: o.width, type: WidthType.DXA },
  shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
  margins: { top: o.pad ?? 70, bottom: o.pad ?? 70, left: 100, right: 100 },
  children: String(t).split('\n').map(x => new Paragraph({
    spacing: { after: 40, line: 260 },
    children: [new TextRun({ text: x, bold: o.bold, size: 19, font: 'Calibri', color: o.shade === ACCENT ? 'FFFFFF' : undefined })],
  })),
});
const tbl = (head, rows, widths, opt = {}) => new Table({
  columnWidths: widths,
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  rows: [
    new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, shade: ACCENT, width: widths[i], pad: opt.pad })) }),
    ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, { bold: i === 0, shade: i === 0 ? GREY : undefined, width: widths[i], pad: opt.pad })) })),
  ],
});
const CALLOUT = (title, body) => new Paragraph({
  spacing: { before: 160, after: 200, line: 276 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 12 } },
  children: [
    new TextRun({ text: title + ' ', bold: true, size: 21, font: 'Calibri' }),
    new TextRun({ text: body, size: 21, font: 'Calibri' }),
  ],
});
const BREAK = () => new Paragraph({ children: [new PageBreak()] });

// Sections: a portrait document with a few landscape pages for the widest
// diagrams. `section(LANDSCAPE)` closes what came before as portrait and
// starts collecting landscape content, and the reverse.
const MARGIN = { top: 1100, bottom: 1100, left: 1100, right: 1100 };
const PORTRAIT = { page: { size: { width: 11906, height: 16838 }, margin: MARGIN } };
const LANDSCAPE = { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: MARGIN } };
const footer = () => ({
  default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8A8A85', font: 'Calibri' })] })] }),
});
const sections = [];
let current = { properties: PORTRAIT, children: [] };
const add = (...x) => current.children.push(...x.flat());
const section = (properties) => {
  if (current.children.length) sections.push({ ...current, footers: footer() });
  current = { properties, children: [] };
};

// ============================== TITLE ========================================
add(
  new Paragraph({ spacing: { before: 1900, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'SOFTWARE REQUIREMENTS SPECIFICATION', bold: true, size: 32, color: ACCENT, font: 'Calibri' })] }),
  new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Sufria — WhatsApp Direct Ordering Platform for Restaurants', bold: true, size: 26, font: 'Calibri' })] }),
  new Paragraph({ spacing: { after: 700 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'CHAPTER 3 — SYSTEM DESIGN', bold: true, size: 40, color: ACCENT, font: 'Calibri' })] }),
);
add(tbl(['Field', 'Value'], [
  ['Project Name', 'Sufria (WhatsApp Direct Ordering Platform for Restaurants)'],
  ['Prepared By', 'Mohammed Walid Ziada'],
  ['Supervisor', 'Eng. Hamza Abu Jarad'],
  ['Organization / Program', 'Taqat Program'],
  ['Document', 'Chapter 3 — System Design (companion to SRS Chapters 1–2, Version 1.3)'],
  ['Version', 'Version 1.2 — brought in line with the code on the main branch on 10 October 2026'],
  ['Date', '10 October 2026'],
], [3000, 6300]));

add(CALLOUT('What changed in version 1.2.',
  'Version 1.1 (14 August 2026) described a design, much of it ahead of the code. Version 1.2 describes the system as built on 10 October 2026. Every diagram was regenerated or redrawn against the code, and every figure, story or statement about something not built says so: partially built, in progress, planned, deferred, or design only. FR-22 to FR-28, added in SRS version 1.3, are traced throughout. The sections that changed most are 3.3 (stories with their status), 3.4.2 (the deployment as it is today), 3.5 (fifteen tables after fifteen migrations), 3.7 (the cash order, the reorder and the pause as built), 3.9 (fifteen isolation assertions and four negative controls) and 3.10 (decisions made during construction); 3.12 and 3.13 are new.'));

add(CALLOUT('Method note.',
  'The diagrams in this chapter were not drawn ahead of implementation and then hoped to match it. The entity-relationship diagram in Section 3.5 is generated programmatically from the live database catalogue by scripts/generate-erd.mjs, after all fifteen migrations, so it cannot silently drift from the schema. The other diagrams were checked against the code on the main branch; where a figure shows something that is not built, the figure says so in its own text. Where the design deliberately departs from an earlier decision, the departure and its reason are recorded in Section 3.10 rather than quietly applied.'));

add(BREAK());

// ============================== 3.1 ==========================================
add(H('3.1 Purpose and Scope of This Chapter', HeadingLevel.HEADING_1));
add(P('Chapters 1 and 2 established what the system must do. This chapter establishes how it is built: the boundary between the system and the world around it, the decomposition into components, the data model, the class structure, the two state machines that govern every order and every conversation, and the security design that keeps one restaurant\'s data invisible to another.'));
add(P('The chapter is organised so that each section answers one question:'));
[
  '3.2 — What sits outside the system, and what crosses the boundary?',
  '3.3 — Who uses it, and for what? (traced to FR-01 … FR-28, with the status of each)',
  '3.4 — What are the components, and where do they run today?',
  '3.5 — What is stored, and what does the database itself refuse to allow?',
  '3.6 — What are the classes, and how do they collaborate?',
  '3.7 — How does the system behave over time?',
  '3.8 — How does data move between processes and stores?',
  '3.9 — How is tenant isolation actually enforced, and how was it verified?',
  '3.10 — Which design decisions were made, and why?',
  '3.11 — Where are the detailed records?',
  '3.12 — Which requirements were added since version 1.1, and where do they stand?',
  '3.13 — What is known to be missing or fragile in what is built?',
].forEach(t => add(BULLET(t)));
add(CALLOUT('Reading the status of a figure.',
  'In the use case and component diagrams, a teal outline means built, a brown outline partially built, a dashed amber box planned or in progress, and a dashed grey box deferred. A sequence diagram of something not built opens with the words DESIGN — NOT BUILT. Statuses are those of 10 October 2026.'));

// ============================== 3.2 ==========================================
add(H('3.2 System Context', HeadingLevel.HEADING_1));
add(P('The Sufria platform sits between two human audiences that never meet inside it — the customer, who only ever sees WhatsApp, and the restaurant staff, who only ever see a browser dashboard. It depends on one external service it does not control, Meta\'s WhatsApp Cloud API, and is designed for two more that are not connected yet: a payment provider, deferred with online payment, and error and uptime monitoring, planned with hosting (NFR-05). The Sufria team configures each restaurant with an onboarding script.'));
add(figure('02-context', 'System context diagram (Level-0 data flow) — dashed: not connected yet'));
add(P('Three properties of this boundary shape the rest of the design. First, the customer never touches Sufria directly: every inbound and outbound message passes through Meta, so delivery is observable but not guaranteed by us; Meta\'s delivery-status callbacks are received and, today, deliberately ignored (NFR-05). Second, once online payment is built the provider becomes a second inbound webhook source, with the same duplicate-delivery and signature-verification requirements as WhatsApp; the deduplication table already tells the two apart by source. Third, since 1 October 2026 Meta bills service messages — the free-form replies inside WhatsApp\'s 24-hour customer-service window — per message, as it already billed templates. Every message the bot sends is a cost, which is why the design counts outbound messages per order and stores every text (Section 3.5.3) rather than treating message volume as an operational detail.'));

// ============================== 3.3 ==========================================
add(BREAK());
add(H('3.3 User Stories and Use Case Model', HeadingLevel.HEADING_1));
add(P('This section states the same requirements twice on purpose: once as user stories with acceptance criteria, which is the form the development team works from, and once as use case diagrams, which show how the actors and their capabilities relate. Every story traces to a functional requirement in Chapter 2 and states where that requirement stands.'));

add(H('3.3.1 User Stories', HeadingLevel.HEADING_2));
add(tbl(['ID', 'Story', 'Acceptance criteria', 'Traces to · status'],
  STORIES.map(st => [st[0], st[1], st[2], st[3]]),
  [800, 2900, 3900, 1700]));

add(CALLOUT('Stories US-21 to US-27 trace to requirements added in SRS version 1.3.',
  'Version 1.1 of this chapter proposed three of them — staff authentication (FR-23), the customer list (FR-24) and opening hours (FR-22) — because the scope implied them and no requirement covered them. SRS version 1.3 adopted all three and added four for capabilities built or decided since August: the session timeout (FR-25), order details with the conversation (FR-26), restaurant settings (FR-27) and pausing orders (FR-28). Section 3.12 lists them.'));

add(H('3.3.2 Actors', HeadingLevel.HEADING_2));
add(P('Six actors interact with the system. The customer and the restaurant staff are human; the restaurant owner is a staff member with wider permissions; the Sufria team onboards each restaurant with a script. Two actors have no human behind them: the notifier, a loop inside the engine that runs every five seconds, and a scheduler that is not built yet. Modelling them is a deliberate choice, because several requirements — the pickup expiry, the payment timeout, refunds — have no human initiator at all. The session timeout needs neither: it is triggered by the customer\'s next message.'));

section(LANDSCAPE);
add(H('3.3.3 Customer Use Cases', HeadingLevel.HEADING_2));
add(figure('03a-use-case-customer', 'Customer use cases — the entire customer-facing surface', FIT.landscape));
add(Rich([
  { text: 'FR-08 is modelled as an ' },
  { text: 'extension', italics: true },
  { text: ' of starting a conversation: the last order appears inside the welcome itself, and one word — «نفسه», "the same" — fills the cart and skips building it; pickup or delivery and the summary follow as usual. It is the use case the 30-second reorder target of NFR-03 depends on (not measured yet), and the one capability a customer can experience as better than an aggregator rather than merely equivalent. FR-22, FR-25 and FR-28 extend the same flow at the points where the restaurant is closed, the conversation has gone silent, or ordering is paused.' },
]));

add(H('3.3.4 Restaurant Use Cases', HeadingLevel.HEADING_2));
add(figure('03b-use-case-restaurant', 'Restaurant staff and owner use cases', FIT.landscape));
add(P('The split between staff and owner is authorization, not architecture: both authenticate through the same account model, and both are subject to the same membership check on every request. A staff member of one branch has no visibility into a sibling branch of the same chain, even though a single account may legitimately hold membership in both (Section 3.9). Menu management and the pause switch have their API, covered by tests; their dashboard screen is being built.'));

add(H('3.3.5 System-Initiated Use Cases', HeadingLevel.HEADING_2));
add(figure('03c-use-case-system', 'System-initiated behaviour — no human actor', FIT.landscape));
add(P('One of these behaviours runs today on a timer: the notifier, which every five seconds sends the customer the message for a status change. The session timeout needs no timer — it is checked when the customer\'s next message arrives. The pickup expiry, the payment timeout and refunds need a scheduler that is not built. The notifier alone is reason enough that the engine must run continuously once hosted: a host that suspends on inactivity would not just delay a webhook, it would silently stop telling customers that their order is ready.'));

section(PORTRAIT);
add(H('3.3.6 Use Case to Requirement Traceability', HeadingLevel.HEADING_2));
add(P('Of the 28 functional requirements, 11 are built, 5 partially built, 2 in progress, 1 not built and 9 deferred.'));
add(tbl(['FR', 'Use case', 'Actor', 'Priority', 'Status'], [
  ['FR-01', 'Register and configure the restaurant', 'Sufria team / Owner', 'Must', 'Partially built'],
  ['FR-02', 'Manage the menu', 'Owner / Staff', 'Must', 'In progress (API built)'],
  ['FR-03', 'WhatsApp number per restaurant', 'Platform', 'Must', 'Partially built'],
  ['FR-04', 'Customise message templates', 'Owner', 'Should', 'Deferred'],
  ['FR-05', 'Start a conversation and receive the menu', 'Customer', 'Must', 'Built'],
  ['FR-06', 'Build the cart with item numbers', 'Customer', 'Must', 'Built'],
  ['FR-07', 'Review the summary and confirm', 'Customer', 'Must', 'Built'],
  ['FR-08', 'Repeat the last order in one word', 'Customer', 'Must (highest business priority)', 'Built'],
  ['FR-09', 'Choose pickup or delivery', 'Customer', 'Must', 'Built'],
  ['FR-10', 'Pay — cash; online deferred', 'Customer', 'Must', 'Partially built'],
  ['FR-11', 'Notify the customer of a status change', 'Notifier', 'Must', 'Built'],
  ['FR-12', 'View live orders and history', 'Staff', 'Must', 'Built'],
  ['FR-13', 'Accept, progress or cancel an order', 'Staff / Scheduler', 'Must', 'Partially built'],
  ['FR-14', 'Update customer statistics', 'System', 'Must', 'Not built'],
  ['FR-15', 'Process payment and refund', 'System / Provider', 'Must', 'Deferred'],
  ['FR-16', 'Manage subscription', 'Owner / System', 'Must', 'Deferred'],
  ['FR-17', 'View basic analytics', 'Owner', 'Should', 'Deferred'],
  ['FR-18', 'View Ownership / Health Score', 'Owner', 'Should', 'Deferred'],
  ['FR-19', 'View conversion funnel', 'Owner', 'Could', 'Deferred'],
  ['FR-20', 'View customer timeline', 'Owner', 'Could', 'Deferred'],
  ['FR-21', 'See at-risk customers', 'Owner', 'Could', 'Deferred'],
  ['FR-22', 'Told the restaurant is closed', 'Customer', 'Must', 'Built'],
  ['FR-23', 'Sign in', 'Staff', 'Must', 'Built'],
  ['FR-24', 'Customer list', 'Owner / Staff', 'Should', 'Deferred'],
  ['FR-25', 'Start over after 60 minutes of silence', 'Customer', 'Must', 'Built'],
  ['FR-26', 'Order details with the conversation', 'Staff', 'Should', 'Built'],
  ['FR-27', 'Change hours, delivery fee and contact number', 'Owner', 'Should', 'Partially built'],
  ['FR-28', 'Pause and resume ordering', 'Staff', 'Should', 'In progress (API built)'],
], [800, 3300, 1800, 1500, 1900], { pad: 40 }));

// ============================== 3.4 ==========================================
section(LANDSCAPE);
add(H('3.4 Architectural Design', HeadingLevel.HEADING_1));
add(H('3.4.1 Component Structure', HeadingLevel.HEADING_2));
add(P('The system is one repository containing four workspace packages: the conversation engine, the dashboard API, the dashboard web application, and a shared package that all three import. The shared package is not a convenience — it is the mechanism by which a rule cannot be enforced differently in two places. The table of transitions staff may make is defined once and imported both by the API that refuses a request and by the dashboard that shows the button; the builder of the bot\'s menu message is imported both by the engine, which sends it, and by the API, which measures a menu change against WhatsApp\'s 4,096-character limit before saving it.'));
add(figure('04-component', 'Component diagram — dashed amber: in progress', FIT.landscape));

section(PORTRAIT);
add(P('Two paths into the database exist, and they are deliberately asymmetric. The Dashboard API reaches data only through TenantDbService, whose connection pool is private, so no service can issue a query without a tenant context. The Conversation Engine cannot use the same entry point, because when a webhook arrives there is no authenticated staff member and therefore no restaurant yet; it resolves one from the WhatsApp phone-number identifier through a narrowly scoped privileged function, and then operates under exactly the same row-level security as every other request. A second privileged function serves the notifier, which runs outside any request: it lists the restaurants that have a notification pending, as identifiers only. These two functions are the engine\'s entire privileged surface, and the isolation gate checks who may call the second and what it returns (Section 3.9.1).'));

add(H('3.4.2 Deployment', HeadingLevel.HEADING_2));
add(figure('05-deployment', 'Deployment diagram — today, and the planned hosting'));
add(CALLOUT('As built.',
  'The three processes run on a development machine, each on its own port, against a local PostgreSQL 16 whose two application roles are neither superusers nor exempt from row-level security; the tests run on a separate PostgreSQL instance with roles of its own. Meta reaches the engine through a cloudflared tunnel, and the bot answers on Meta\'s test number. No host has been chosen. NFR-07 and ADR-003 plan to deploy the two backend modules as a single process when first hosted, because free always-on hosting provides one continuously running service and the engine is the module that cannot sleep: the notifier runs on a timer. The code runs them as two processes today, and the modules stay independently deployable, so splitting them again later is a configuration change, not a rewrite.'));

// ============================== 3.5 ==========================================
add(BREAK());
add(H('3.5 Data Design', HeadingLevel.HEADING_1));
add(H('3.5.1 Entity Relationship Diagram', HeadingLevel.HEADING_2));
add(P('The following diagram is generated from the live database catalogue, not drawn by hand. It reflects 15 tables and 21 foreign-key relationships exactly as they exist after migrations 0001 through 0015. Row-level security is enabled and forced on 13 of the tables.'));
add(figure('01-erd', 'Entity relationship diagram (generated from information_schema)'));

add(H('3.5.2 Table Catalogue', HeadingLevel.HEADING_2));
add(tbl(['Table', 'Purpose', 'RLS'], [
  ['staff_accounts', 'Login identity, with the hash of the current refresh token. One account may hold membership in several restaurants of a chain.', 'No — read at login, before any tenant context can exist. Holds no tenant business data.'],
  ['restaurants', 'Tenant root: chain, WhatsApp phone-number identifier, opening hours and timezone, delivery offer and fee, currency, contact number, the time orders were paused, payment settings, and the assumed commission rate used by FR-18.', 'Yes'],
  ['restaurant_staff', 'Membership join table. The single most security-critical table: the authorization guard reads it on every request.', 'Yes'],
  ['menu_categories', 'Menu structure, ordered and independently switchable.', 'Yes'],
  ['menu_items', 'Items with price, availability and the time they were archived. A composite foreign key keeps an item and its category in the same restaurant; a CHECK keeps an archived item unavailable.', 'Yes'],
  ['customers', 'Per-restaurant customer record. Unique on (restaurant_id, phone_number): the same phone number at two restaurants is two distinct customers, by design. Its statistics columns are not written yet (FR-14).', 'Yes'],
  ['conversation_sessions', 'Conversation state machine and cart context (jsonb). At most one active session per customer.', 'Yes'],
  ['orders', 'Order header with a per-restaurant order number, fulfilment, delivery fee and address. Created at the customer\'s confirmation, never at payment confirmation.', 'Yes'],
  ['order_items', 'Line items with name and unit price snapshotted at order time.', 'Yes'],
  ['order_status_history', 'Append-only audit trail with referential integrity to the acting staff account.', 'Yes'],
  ['inbound_messages', 'Every customer message the webhook accepted, with its raw payload.', 'Yes'],
  ['outbound_messages', 'Every text the engine sent, since migration 0013. With inbound_messages it shows an order\'s conversation (FR-26).', 'Yes'],
  ['processed_webhook_events', 'Unified deduplication gate for WhatsApp and, later, payment webhooks.', 'No — written before the restaurant is resolved, including on the first message of a new conversation. Contains only opaque provider event identifiers.'],
  ['subscriptions', 'Fixed monthly billing state (FR-16, deferred; nothing writes it yet).', 'Yes'],
  ['message_templates', 'WhatsApp templates; a NULL restaurant_id denotes a platform default. Nothing reads it yet (FR-04, deferred).', 'Yes'],
], [2100, 4600, 2600]));

add(H('3.5.3 Deliberate Departures from the Initial Schema', HeadingLevel.HEADING_2));
add(P('Four columns in the first migrations were not in the original design. Each was added for a reason that only became visible when the schema was executed rather than described (ADR-002).'));
add(tbl(['Addition', 'Reason'], [
  ['restaurant_id on order_items and order_status_history', 'Without it, the row-level security policy on these two tables becomes a correlated subquery evaluated per row, on the two tables that grow fastest. With it, the policy is an index-backed equality check. Consistency is guaranteed structurally by a composite foreign key — an orphan row carrying the wrong restaurant_id cannot be written.'],
  ['orders.ready_at', 'The 24-hour pickup expiry (not built yet) is defined as 24 hours from entering the ready state. Deriving that from the append-only history table would mean scanning it on every sweep for a timestamp that can simply be recorded.'],
  ['orders.outbound_msg_count', 'Since 1 October 2026 every service message is billed, so messages per order is an engineering constraint rather than an accounting line, and the subscription price must be set against a measured figure. The engine counts the messages of a conversation and carries the count onto the order.'],
  ['actor + actor_staff_id replacing a single changed_by column', 'A single column holding either a UUID or a fixed string cannot carry a foreign key, which would have made the audit trail the only table in the schema without referential integrity.'],
], [3200, 6100]));

add(H('3.5.4 Schema Changes Since Version 1.1', HeadingLevel.HEADING_2));
add(P('Twelve migrations were added after version 1.1. Migrations are append-only: once one has run anywhere, a change is a new file, never an edit. Since 5 October 2026 the migration runner records every file it applies in a ledger table, in the same transaction as the file, so applying migrations to an existing database applies only the new ones.'));
add(tbl(['Migration', 'Change', 'Reason'], [
  ['0004', 'Refresh-token hash and expiry on staff_accounts', 'A stolen database must not hand over usable sessions: only a hash of the refresh token is kept.'],
  ['0005', 'app.restaurants_for_staff() — privileged, dashboard role', 'Login must list an account\'s restaurants before any tenant context exists; the function answers exactly that.'],
  ['0006', 'inbound_messages', 'Every accepted customer message is stored, after the signature check and the deduplication gate.'],
  ['0007', 'A partial unique index: one active session per customer', 'Two simultaneous first messages cannot open two conversations.'],
  ['0008', 'restaurants.timezone', 'Opening hours are evaluated in the restaurant\'s own timezone, held in a checked column instead of inside the hours jsonb.'],
  ['0009', 'restaurants.contact_phone', 'The number given to a customer whose messages were not understood three times in a row.'],
  ['0010', 'Delivery fee on restaurants and orders; delivery address on orders', 'Delivery, with its fee snapshotted on the order and an address required by a CHECK.'],
  ['0011', 'A per-restaurant order number; restaurants.currency', 'The first real conversation\'s confirmation carried no number; amounts carry the restaurant\'s currency, JOD or ILS.'],
  ['0012', 'app.restaurants_with_unnotified_orders() — privileged, engine role only', 'The notifier has no tenant context; it learns which restaurants have a notification pending, as identifiers only.'],
  ['0013', 'outbound_messages', 'Every text the engine sends, so an order\'s details can show the whole conversation.'],
  ['0014', 'restaurants.orders_paused_at; menu_items.archived_at', 'Pausing orders (FR-28), and archiving menu items instead of deleting them (FR-02).'],
  ['0015', 'idx_orders_customer_recent', 'The last-order suggestion (FR-08) reads a customer\'s orders through one partial index.'],
], [1100, 3700, 4500]));

add(H('3.5.5 Constraints Enforced by the Database', HeadingLevel.HEADING_2));
add(P('Rules that can be expressed as constraints are enforced by the database rather than by application code, so that a future code path cannot violate them by omission.'));
add(tbl(['Constraint', 'Rule', 'Source'], [
  ['orders_completed_payment_settled', 'A completed order\'s payment_status must be exactly paid or collected.', 'NFR-09'],
  ['orders_collected_is_cash', 'collected is reachable only for cash orders.', 'NFR-09'],
  ['orders_cancelled_by_consistent', 'cancelled_by is set if and only if the order is cancelled.', 'FR-13'],
  ['orders_ready_at_consistent', 'ready_at exists only once the order has actually reached ready.', 'Section 3.5.3'],
  ['orders_expired_is_pickup', 'expired is reachable only for pickup orders.', 'FR-13'],
  ['orders_delivery_has_address', 'A delivery order carries an address of 1 to 300 characters.', 'FR-09'],
  ['orders_pickup_has_no_delivery_data', 'A pickup order has no delivery fee and no address.', 'FR-09'],
  ['orders_total_is_subtotal_plus_fee', 'total = subtotal + delivery_fee.', 'FR-07'],
  ['orders_order_number_positive and UNIQUE (restaurant_id, order_number)', 'Order numbers are positive and unique within a restaurant.', 'FR-07'],
  ['menu_items_archived_not_available', 'An archived item is never available.', 'FR-02'],
  ['restaurants_currency_check', 'A restaurant\'s currency is JOD or ILS.', 'FR-01'],
  ['restaurants_timezone_not_blank', 'Every restaurant has a timezone.', 'FR-22'],
  ['osh_actor_staff_consistent', 'actor_staff_id is present exactly when the actor is staff.', 'NFR-09'],
  ['UNIQUE (event_id, source)', 'The deduplication gate. The same identifier from a different source is a distinct event.', 'NFR-04'],
  ['UNIQUE (restaurant_id, wa_message_id)', 'A WhatsApp message is stored once per restaurant.', 'NFR-04'],
  ['idx_sessions_one_active_per_customer (partial, unique)', 'At most one active conversation per customer.', 'FR-05'],
  ['UNIQUE (restaurant_id, phone_number)', 'One customer record per phone number per restaurant.', 'FR-14'],
  ['UNIQUE (staff_account_id, restaurant_id)', 'One membership row per account per restaurant.', 'NFR-02'],
], [3300, 4500, 1500]));

add(H('3.5.6 Index Design', HeadingLevel.HEADING_2));
add(P('Twenty-four named indexes exist: twenty from migration 0002 and one each from 0006, 0007, 0013 and 0015. (Version 1.1 counted nineteen; 0002 holds twenty.) Fourteen are partial indexes, sized to the working set rather than to the table. Several back paths that are designed but not built — the pickup expiry, the payment timeout, VIP flags, the funnel, subscriptions — and no query uses them yet; they were created with the first schema so those paths need no migration. One, idx_orders_customer_completed, was designed for a reorder that suggested the usual completed order; the built FR-08 reads accepted orders through idx_orders_customer_recent instead. Five illustrate the method:'));
[
  'idx_orders_unnotified — partial on notified = false. The notifier reads it every five seconds; a full index would grow with total order history rather than with the handful of unnotified rows.',
  'idx_orders_customer_recent — partial on every status except cancelled and expired. Both FR-08 queries carry exactly that predicate, so the planner can use the index without having to infer it.',
  'idx_sessions_one_active_per_customer — partial and unique: the database itself refuses a second active conversation for the same customer.',
  'idx_restaurant_staff_lookup — read on every authenticated request by the membership check, before row-level security applies. If this is slow, the entire dashboard is slow.',
  'idx_orders_pickup_expiry — partial on ready pickup orders, ordered by ready_at. It waits for the scheduler.',
].forEach(t => add(BULLET(t)));

// ============================== 3.6 ==========================================
add(H('3.6 Class Design', HeadingLevel.HEADING_1));
add(H('3.6.1 Authentication and Authorization Chain', HeadingLevel.HEADING_2));
add(figure('06a-class-auth', 'Class diagram — authentication and tenant context'));
add(Rich([
  { text: 'The numbered collaboration in Figure 3.8 is the security model, and its order is the property being protected. ' },
  { text: 'JwtAuthGuard', italics: true }, { text: ' establishes who is calling; ' },
  { text: 'RestaurantContextGuard', italics: true }, { text: ' establishes whether they may act in this restaurant; only then does ' },
  { text: 'TenantDbService', italics: true }, { text: ' establish what they can see. Performing the third step before the second would let the caller nominate their own tenant identifier, and row-level security would faithfully serve that tenant\'s data. Row-level security constrains a request to one restaurant; it has no opinion about which one. That decision is made in the guard and nowhere else, and a test of the application itself checks that it is (Section 3.9.1).' },
]));

add(H('3.6.2 Order Management — Dashboard Side', HeadingLevel.HEADING_2));
add(figure('06b-class-orders', 'Class diagram — orders and the shared domain package'));
add(P('The menu, menu-category and restaurant controllers are collapsed into one box here because their structure is identical to the orders path: a controller behind the two guards, a service, and the same single data path. Nothing in the API reaches the database except through TenantDbService. A status change is one compare-and-swap UPDATE, without a row lock: two staff acting on the same order at once cannot both succeed, and the one who loses is told the order\'s current status.'));

add(H('3.6.3 Conversation Handling — Engine Side', HeadingLevel.HEADING_2));
add(figure('06c-class-conversation', 'Class diagram — webhook intake and conversation routing'));
add(P('The webhook service calls the deduplication gate before it calls anything else, including before the restaurant is resolved. This ordering is what makes the gate effective on the very first message of a brand-new conversation, where no session exists yet to hold a reference to what has already been seen. ConversationService then decides in a fixed order. A silent session expires first. An active session is answered with the paused text if orders are paused, and otherwise routed to the handler for its state. A new conversation passes the opening-hours gate, then the pause gate, then reads the last-order suggestion — and only then is a session opened.'));

add(H('3.6.4 Order Creation and Outbound Messaging', HeadingLevel.HEADING_2));
add(figure('06d-class-order-engine', 'Class diagram — order creation, outbound messaging and the notifier'));
add(P('CriticalPrimitives is modelled as a module rather than a service because it holds the database operations on which the correctness of the system depends: the deduplication claim, the compare-and-swap state advance, the row locks and the scheduler claims. They are collected in one place and imported, never reimplemented inline, so that a defect in any of them has one location rather than several. Two of its six functions are used today; the other four wait for the pickup expiry, the payment timeout and online payment. Every text the engine sends passes through one wrapper, which stores it after a successful send; a failed store is logged and never fails the reply.'));

// ============================== 3.7 ==========================================
section(LANDSCAPE);
add(H('3.7 Behavioural Design', HeadingLevel.HEADING_1));
add(H('3.7.1 Order State Machine', HeadingLevel.HEADING_2));
add(figure('07-state-order', 'Order status state machine', FIT.landscapeShort));
add(P('Two distinctions in this machine carry business meaning and are deliberately not merged. An order that is cancelled had someone actively cancel it; an order that is expired sat in ready for 24 hours and was never collected. They are different events with different consequences: once the scheduler that produces expired is built, an expired order will never update customer statistics, because any payment on it is refunded. The second distinction is that accepting an online order is gated on payment: before payment is confirmed, the only action available to staff is cancellation. Online payment is deferred, but the gate is already part of the status update\'s compare-and-swap, and a test holds it.'));

section(PORTRAIT);
add(H('3.7.2 Conversation Session State Machine', HeadingLevel.HEADING_2));
add(figure('08-state-session', 'Conversation session state machine'));
add(CALLOUT('The most important property in this diagram is what it does not do.',
  'A session may be abandoned after sixty minutes of silence, but no order is touched. The two lifecycles are independent by design. For a cash order the session is already closed (order_placed) by the time the order exists. For online payment, once it is built, a customer who takes an hour to pay will lose the conversation but not the order, and the payment confirmation will update the order regardless of the session\'s state. Conflating the two would cancel valid orders.'));

add(H('3.7.3 Activity — Placing a Cash Order', HeadingLevel.HEADING_2));
add(P('The complete path from an inbound message to an order visible on the restaurant dashboard, shown in three parts. Part (b) holds every gate a new conversation passes — opening hours, the pause, an empty or oversized menu — and the last-order suggestion.'));
add(figure('09a-activity-cash-intake', 'Cash order (a) — webhook authentication and deduplication'));
add(figure('09b-activity-cash-route', 'Cash order (b) — tenant context, gates and routing'));
add(figure('09c-activity-cash-commit', 'Cash order (c) — atomic order creation'));
add(P('Two guards in this path defend against different duplicates and neither substitutes for the other. The deduplication gate in part (a) stops the same message being processed twice when Meta redelivers it. The compare-and-swap in part (c) stops a legitimate action being performed twice when the customer sends the confirm word twice — those are two genuinely distinct messages with distinct identifiers, so the deduplication gate passes both, correctly. Removing either one reopens a duplicate-order path through a different door.'));

add(H('3.7.4 Activity — Staff Status Update', HeadingLevel.HEADING_2));
add(figure('10a-activity-status-auth', 'Status update (a) — authentication, authorization and gates'));
add(figure('10b-activity-status-apply', 'Status update (b) — transactional effects'));
add(P('The refusal in part (a) returns an identical response whether the restaurant does not exist or the caller is not a member of it. Distinguishing the two would allow a caller to enumerate restaurants by comparing responses.'));

add(H('3.7.5 Sequence Diagrams for the Core Scenarios', HeadingLevel.HEADING_2));
add(P('Four of these sequences are built. Three are designs for online payment and the scheduler, kept so that those features are built against a reviewed design rather than improvised; each opens with the words DESIGN — NOT BUILT.'));
add(figure('14-seq-webhook-gate', 'Inbound WhatsApp webhook — the unified entry gate (built)'));
add(figure('12-seq-cash-order', 'Cash order creation (built)'));
add(figure('13-seq-online-payment', 'Online payment through to confirmation, including the late-webhook refund path (design — not built)'));
section(LANDSCAPE);
add(figure('15-seq-status-update', 'Restaurant-initiated status update (built) and the scheduled paths (not built)', FIT.landscapeAlone));
section(PORTRAIT);
add(figure('16-seq-proactive-reorder', 'Repeating the last order in one word, FR-08 — the highest business priority path (built)'));
section(LANDSCAPE);
add(figure('17-seq-payment-timeout', 'Payment timeout and the one-directional online-to-cash fallback (design — not built)', FIT.landscapeAlone));
section(PORTRAIT);
add(figure('18-seq-concurrent-cancel', 'Concurrent cancellation and payment confirmation — the refund invariant (design — not built)'));
add(CALLOUT('Defect found and corrected during design review.',
  'In the online payment design, if the payment confirmation arrives after the order has already been cancelled or expired, the refund fires immediately inside the payment webhook handler rather than waiting to be noticed by the cancellation path. The earlier design depended on the cancellation path discovering the payment later, which for a payment arriving after cancellation meant it never would. This is recorded because the review that found it is part of the design method, not an embarrassment to be hidden.'));

// ============================== 3.8 ==========================================
add(BREAK());
add(H('3.8 Data Flow', HeadingLevel.HEADING_1));
add(figure('11-dfd-level1', 'Level-1 data flow diagram'));
add(P('Process 1.0 is the only entry point for external events and performs three things in a fixed order before anything else runs: signature verification, schema validation, and the deduplication check against store D1. Process 7.0 is the equivalent gate on the staff side, and both staff processes — order management (4.0) and menu and settings (8.0) — run only on the restaurant context it verified. Every other process operates on data that has already passed one of these two gates and is already scoped to a single restaurant. Process 6.0, analytics, is deferred.'));

// ============================== 3.9 ==========================================
add(H('3.9 Security Design', HeadingLevel.HEADING_1));
add(P('Tenant isolation is enforced by PostgreSQL row-level security rather than by application-level filtering. The distinction matters for a specific reason: application filtering requires every query to remember a WHERE clause, and a system with dozens of queries needs only one omission to disclose another restaurant\'s data. Under row-level security a forgotten predicate returns zero rows rather than another tenant\'s rows.'));
add(P('Three implementation properties are load-bearing, and each is easy to break by accident:'));
[
  'The application connects using a role that is neither a superuser nor granted BYPASSRLS. A superuser bypasses every policy unconditionally, without any error message, and managed database providers issue an administrative connection string by default. The application checks its own role at start-up and refuses to run otherwise.',
  'The tenant context is set with a transaction-scoped setting. A session-scoped setting persists on a pooled connection and is inherited by whichever request borrows that connection next — a cross-tenant read that no single-tenant test can reproduce.',
  'The restaurant identifier is passed as a bind parameter. The SET LOCAL statement cannot accept one, which is exactly why it is not used: string interpolation there would place an injection point inside the tenant boundary itself.',
].forEach(t => add(BULLET(t)));

add(H('3.9.1 Verification', HeadingLevel.HEADING_2));
add(P('The design is verified rather than asserted. A mandatory gate of fifteen assertions runs in continuous integration on every push to the main branch, and the repository\'s first rule is that nothing merges while it is red. The case it exists for is a single staff account holding an active membership in two branches of the same chain — a caller who is genuinely authorized for both, where the boundary that must hold is per-request rather than per-user. Assertions A13 to A15, added with the notifier, hold the engine\'s second privileged function to its narrow purpose.'));
add(tbl(['#', 'Assertion', 'Expected'], [
  ['A1', 'Query with no tenant context', 'Zero rows — the system fails closed'],
  ['A2', 'Chain staff in branch A reading branch B', 'Sibling branch completely invisible'],
  ['A3', 'Same connection, context switched to B', 'Sees B only, never A'],
  ['A4', 'Query after the previous transaction ended', 'Zero rows — no pooled-connection inheritance'],
  ['A5', 'INSERT into a foreign tenant', 'Rejected by WITH CHECK'],
  ['A6', 'UPDATE moving a row to a foreign tenant', 'Rejected'],
  ['A7', 'DELETE targeting a foreign tenant', 'Zero rows affected'],
  ['A8', 'Reading a foreign tenant\'s order items and history', 'Rejected — the denormalisation opened no hole'],
  ['A9', 'Forged unknown restaurant identifier', 'Zero rows'],
  ['A10', 'Empty context value', 'Zero rows — not treated as a wildcard'],
  ['A11', 'Membership verification for a non-member', 'False, including a sibling branch of the same chain'],
  ['A12', 'Deactivated membership', 'Access revoked immediately'],
  ['A13', 'Who may call the notifier\'s privileged function', 'The engine role only — not the API role, not PUBLIC; security definer with a pinned search_path'],
  ['A14', 'A restaurant whose orders are all notified', 'Not listed'],
  ['A15', 'What the function returns', 'Restaurant identifiers only, never an order identifier; the result type is exactly a set of UUIDs'],
], [700, 4500, 4100]));
add(CALLOUT('The gate is itself verified.',
  'A security test that has never been observed failing is an assertion of truth wearing a costume. A companion script deliberately breaks isolation four ways and confirms the gate turns red for each: row-level security disabled on a table, the application role granted superuser, the tenant context set session-scoped instead of transaction-scoped, and the notifier\'s privileged function granted to the API role. The second is the most common real-world failure, because it is what a managed hosting provider hands you by default. Because that control alters an application role, the gate runs locally on a PostgreSQL instance of its own, never against the database of the demonstration restaurant; in continuous integration it runs on a throwaway database.'));
add(P('The SQL gate sets the tenant context by hand, so it would still pass if the application never set it at all. A test of the application covers that half: it sends real HTTP requests through the API and reads back from PostgreSQL that the context is set per request, only after the guard verified membership, and is never left on a pooled connection.'));

// ============================== 3.10 =========================================
add(H('3.10 Design Decisions and Rationale', HeadingLevel.HEADING_1));
add(P('The first seven decisions were made before construction; the rest were made during it, each when a real case forced the question.'));
add(tbl(['Decision', 'Alternative rejected', 'Rationale'], [
  ['PostgreSQL row-level security for tenant isolation', 'Application-level WHERE filtering', 'One forgotten predicate discloses another restaurant\'s data. Under RLS the same omission returns zero rows.'],
  ['NestJS for the Dashboard API', 'Express', 'The security model is an ordered sequence of guards. NestJS makes the ordering declarative and framework-enforced; in Express it is a convention that a route added in another file can silently break.'],
  ['Drizzle', 'Prisma', 'Three of the four operations the system\'s correctness depends on have no native support in Prisma and would require raw SQL at exactly the points where a defect costs money. Recorded in ADR-001 with an executable proof.'],
  ['Hand-written SQL migrations, append-only', 'ORM-generated migrations', 'RLS policies, FORCE ROW LEVEL SECURITY, privileged functions, CHECK constraints and partial indexes cannot be expressed in either tool\'s schema language and would be silently dropped. The TypeScript schema is a hand-kept mirror, checked against the database for drift.'],
  ['Single repository (monorepo)', 'Three repositories', 'Shared types and rules between the engine, the API and the dashboard would otherwise require package publication or submodules. A change spanning schema, API and interface is one reviewable change rather than three ordered merges.'],
  ['Two backend modules, one process when first hosted (NFR-07)', 'Two services from day one', 'Free always-on hosting provides one continuously running service, and the engine is the module that cannot sleep. Not applied yet: no host is chosen, and today the modules run as two processes.'],
  ['Direct WhatsApp Cloud API', 'A Business Solution Provider', 'The value a BSP adds — webhook handling, inbox, interface — is exactly what this project builds itself. The earlier specification named a provider; that was a verification error, corrected in SRS v1.2.'],
  ['A numbered text menu; items chosen by number', 'WhatsApp interactive lists and buttons', 'Lists allow ten rows and 24-character titles, which no real menu fits, and neither lists nor buttons can express several items in one message. Short choices — pickup or delivery; confirm, edit or cancel — are answered in words.'],
  ['The order row exists before any payment confirmation — created at the confirm word for cash, at method selection for online', 'Created on payment confirmation', 'Resolves a contradiction between FR-10 and the concurrent-cancellation case, which requires an order to exist at the moment a cancellation and a payment confirmation race each other — impossible under create-on-confirmation — without introducing a new order status.'],
  ['Two complementary idempotency layers', 'A single mechanism', 'The event-level gate catches provider redelivery; the compare-and-swap catches a duplicate human action. These are different events, and neither mechanism sees the other\'s case.'],
  ['The webhook answers 200 only when the message is stored, or deliberately and permanently ignored', 'Always answering 200', 'Meta redelivers on any other answer for up to seven days, which makes it a free retry queue; a 200 on a failed store would lose a customer\'s message for good. The health check touches the database for the same reason.'],
  ['The order confirmation is sent after COMMIT', 'Sending inside the transaction', 'A sent WhatsApp message cannot be rolled back. Sending first could hand the customer a confirmation for an order that was never written; a send that fails after the commit is logged, and the order stands. A test that forces a failure at COMMIT holds this.'],
  ['Status messages sent by a notifier that claims each order before sending', 'Sending from the API request', 'At most once: two notifiers cannot send the same message, and the API needs no WhatsApp access. A crash between the claim and the send loses that message, by design: a duplicate is worse.'],
  ['The session timeout is checked when the next message arrives', 'A background job', 'No job to schedule or monitor, and a silent session costs nothing until its customer writes again. The silence is measured with the database\'s clock.'],
  ['A cart line keeps the price it had when it was added', 'Re-pricing at confirmation', 'The price is a promise; availability is a fact. Availability is re-checked at confirmation, and an unavailable item is removed and named.'],
  ['Malformed opening hours are read as open', 'Reading them as closed', 'A restaurant that silently stops taking orders loses money without knowing; one that receives a message out of hours sees it and acts. The dashboard writes only the canonical form.'],
  ['The reorder suggestion is the last order the restaurant accepted (10 October 2026)', 'The most frequent order', 'Predictable for the customer and read from one order; the most frequent order needs a history a new restaurant does not have, and a rule for ties. No suggestion while an order of the customer\'s is under three hours old, so a customer asking about an order on its way is not offered to repeat it.'],
  ['Menu items are archived, never deleted', 'Deletion', 'Past orders keep their link to the item, and an archived item returns switched off, so it never reappears to customers by mistake.'],
  ['A menu change that would push the bot\'s first message past 4,096 characters is refused', 'Truncating or paging the menu', 'A truncated menu hides items silently. Checking where the change is made tells the restaurant at once, instead of a customer later receiving no menu.'],
  ['Jest with ts-jest for every suite that boots NestJS', 'Vitest, or anything compiled by esbuild', 'esbuild drops decorator metadata, and NestJS injection then resolves to undefined at run time while type-checking and linting stay green. ts-jest compiles with tsc, so the metadata survives; one test asserts that injection resolved.'],
], [2600, 2200, 4500]));

add(H('3.11 Traceability to Detailed Design Records', HeadingLevel.HEADING_1));
add(tbl(['Record', 'Subject'], [
  ['ADR-001', 'ORM selection, with an executable verification of the critical operations against PostgreSQL 16.'],
  ['ADR-002', 'The four schema departures documented in Section 3.5.3.'],
  ['ADR-003', 'Full technology stack review: deployment topology, polling intervals, closed tooling choices and monitoring gaps. Its polling recommendation was not followed: the dashboard polls every 10 seconds and the notifier every 5.'],
  ['ADR-004', 'The backend development runner (SWC, not tsx), and why esbuild-based tools break NestJS injection.'],
  ['db/migrations/0001–0015', 'The authoritative schema. Figure 3.7 is generated from the database these produce.'],
  ['scripts/migrate.mjs', 'Applies migrations and records each one in the ledger, in the same transaction as the file.'],
  ['tests/security/chain-isolation.sql', 'The fifteen assertions in Section 3.9.1.'],
  ['tests/security/negative-controls.sh', 'The four deliberate breakages that verify the gate.'],
  ['scripts/generate-erd.mjs', 'Regenerates Figure 3.7 from the live catalogue after any schema change.'],
  ['docs/10 — the opening-hours contract', 'The shape of the opening-hours field, which the database does not enforce.'],
  ['docs/11 to docs/17, docs/brief-*.md', 'The task briefs, from the cart to the menu screen; docs/13 §9 records the Dashboard API contracts as built.'],
  ['CLAUDE.md', 'Repository facts, the rules that do not bend, and the known gaps, kept current with every task.'],
], [3000, 6300]));

add(H('3.12 Requirements Added Since Version 1.1', HeadingLevel.HEADING_1));
add(P('Version 1.1 proposed three requirements that the scope implied and no requirement covered. SRS version 1.3 adopted them and added four more for capabilities built or decided since August.', { keepNext: true }));
add(tbl(['FR', 'Requirement', 'Status (10 October 2026)', 'Where'], [
  ['FR-22', 'Check the opening hours before starting an ordering conversation, and tell a customer the restaurant is closed instead of presenting the menu.', 'Built. Proposed in version 1.1 as not built.', 'US-23 · 3.7.3 · 3.7.5'],
  ['FR-23', 'Authenticate staff, and verify membership in the specific restaurant on every request.', 'Built; covered before only by NFR-02.', 'US-21 · 3.6.1 · 3.9'],
  ['FR-24', 'A searchable customer list with order count, spend and VIP status.', 'Deferred: depends on FR-14.', 'US-22'],
  ['FR-25', 'End a conversation silent for 60 minutes; the next message starts a new one.', 'Built. Prompted by a real failure on 29 September 2026.', 'US-24 · 3.7.2'],
  ['FR-26', 'Show an order\'s details with the conversation that led to it.', 'Built.', 'US-25'],
  ['FR-27', 'Change the opening hours, delivery fee and contact number.', 'Partially built: API built; screen planned.', 'US-26'],
  ['FR-28', 'Pause and resume ordering; while paused, one fixed reply and no order.', 'In progress: engine and API built; screen in progress.', 'US-27 · 3.7.2 · 3.7.3'],
], [800, 4000, 2800, 1700]));
add(CALLOUT('FR-22 was the one proposal that was not a documentation gap.',
  'In August the business_hours field was collected, stored and read by nothing, so the first customer to message outside opening hours would have been taken through a normal order that a closed kitchen then had to cancel. It is now built and tested: the check runs in the restaurant\'s own timezone before the menu is sent, and a closed restaurant answers with the day\'s opening window.'));

add(H('3.13 Known Gaps in the Built System', HeadingLevel.HEADING_1));
add(P('These gaps are known and recorded in the repository, and none is fixed in passing: each is either a product decision still to be made or a cost accepted for now.'));
add(tbl(['Gap', 'Consequence', 'Status'], [
  ['Customer statistics are never written (FR-14)', 'total_orders, total_spend, last_order_at and is_vip keep their defaults; the customer list and the analytics depend on them.', 'Product decision pending'],
  ['A failed order confirmation is not retried', 'The order reaches the dashboard, but the customer hears nothing after confirming; the notifier does not resend it either.', 'Accepted; logged as an error'],
  ['A placed order closes the conversation', 'The next message starts a new conversation with the full menu; there is no "your order is on its way" reply.', 'Product decision before a pilot'],
  ['A closed restaurant answers every message with its closing text', 'Nothing remembers that the customer was already told.', 'Deferred to rate limiting'],
  ['The menu is sent whole, in one message', 'A menu over 4,096 characters is not sent. The dashboard refuses changes that would cross the limit, but a menu close to it silently loses the last-order block.', 'Paging deferred'],
  ['A split shift shows only its first window in the closing message', 'The text has two slots; showing the next window would be a computed promise.', 'By decision'],
  ['The session timestamp is written by the engine\'s clock and read against the database\'s', 'The two hosts\' clocks must agree within seconds.', 'Recorded'],
  ['The customer-facing menu order is written twice', 'Once in the engine and once in the API; changing one does not fail the other.', 'Recorded'],
  ['Negative control 2 alters an application role', 'Locally it runs on a separate PostgreSQL instance; giving the control a role of its own is planned.', 'Planned'],
], [3000, 4300, 2000]));

add(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'End of Chapter 3', bold: true, size: 21, font: 'Calibri' })] }));

// =============================================================================
section(PORTRAIT);
const doc = new Document({
  creator: 'Mohammed Walid Ziada',
  title: 'Sufria — Chapter 3: System Design, Version 1.2',
  numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.18) } } } }] }] },
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  sections,
});
Packer.toBuffer(doc).then(b => {
  fs.writeFileSync(OUT, b);
  console.log('written:', path.relative(process.cwd(), OUT), (b.length / 1024 / 1024).toFixed(1) + ' MB ·', figNo, 'figures ·', sections.length, 'sections');
});
