const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak,
  ImageRun, LevelFormat, convertInchesToTwip,
} = require('docx');

const STORIES = JSON.parse(fs.readFileSync(__dirname + '/stories.json', 'utf8'));
const DIA = '/home/claude/wafa/docs/diagrams';
const ACCENT = '1F4E5F';
const GREY = 'F2F2F0';
const HL = 'DCEEDC';

const png = (n) => fs.readFileSync(`${DIA}/${n}.png`);
const dims = (n) => {
  const d = png(n).subarray(16, 24);
  return { w: d.readUInt32BE(0), h: d.readUInt32BE(4) };
};

const MAXW = 630, MAXH = 800;   // A4 portrait, 1100-twip margins, at 96 dpi

let figNo = 0;
const figure = (name, caption) => {
  const { w, h } = dims(name);
  const s = Math.min(MAXW / w, MAXH / h);
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
  spacing: { after: o.after ?? 120, line: 276 }, alignment: o.align,
  ...(o.border ? { border: o.border } : {}),
  children: [new TextRun({ text: t, bold: o.bold, italics: o.italics, size: o.size ?? 21, font: 'Calibri' })],
});
const Rich = (runs) => new Paragraph({
  spacing: { after: 120, line: 276 },
  children: runs.map(r => new TextRun({ ...r, size: r.size ?? 21, font: 'Calibri' })),
});
const H = (t, lv) => new Paragraph({
  heading: lv, spacing: { before: 300, after: 140 },
  children: [new TextRun({ text: t, bold: true, color: ACCENT, font: 'Calibri' })],
});
const BULLET = (t) => new Paragraph({
  numbering: { reference: 'b', level: 0 }, spacing: { after: 70, line: 276 },
  children: [new TextRun({ text: t, size: 21, font: 'Calibri' })],
});
const cell = (t, o = {}) => new TableCell({
  width: { size: o.width, type: WidthType.DXA },
  shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
  margins: { top: 70, bottom: 70, left: 100, right: 100 },
  children: String(t).split('\n').map(x => new Paragraph({
    spacing: { after: 0, line: 260 },
    children: [new TextRun({ text: x, bold: o.bold, size: 19, font: 'Calibri', color: o.shade === ACCENT ? 'FFFFFF' : undefined })],
  })),
});
const tbl = (head, rows, widths) => new Table({
  columnWidths: widths,
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  rows: [
    new TableRow({ children: head.map((h, i) => cell(h, { bold: true, shade: ACCENT, width: widths[i] })) }),
    ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, { bold: i === 0, shade: i === 0 ? GREY : undefined, width: widths[i] })) })),
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

const c = [];
const add = (...x) => c.push(...x.flat());

// ============================== TITLE ========================================
add(
  new Paragraph({ spacing: { before: 1900, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'SOFTWARE REQUIREMENTS SPECIFICATION', bold: true, size: 32, color: ACCENT, font: 'Calibri' })] }),
  new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Wafa — WhatsApp Direct Ordering Platform for Restaurants', bold: true, size: 26, font: 'Calibri' })] }),
  new Paragraph({ spacing: { after: 700 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'CHAPTER 3 — SYSTEM DESIGN', bold: true, size: 40, color: ACCENT, font: 'Calibri' })] }),
);
add(tbl(['Field', 'Value'], [
  ['Project Name', 'Wafa (WhatsApp Direct Ordering Platform for Restaurants)'],
  ['Prepared By', 'Mohammed Walid Ziada'],
  ['Supervisor', 'Eng. Hamza Abu Jarad'],
  ['Organization / Program', 'Taqat Program'],
  ['Document', 'Chapter 3 — System Design (companion to SRS Chapters 1–2, Version 1.2)'],
  ['Version', 'Version 1.1 — user stories, three sequence diagrams and Section 3.12 merged from Wafa_System_Design v3.0'],
  ['Date', '14 August 2026'],
], [3000, 6300]));

add(CALLOUT('Method note.',
  'The diagrams in this chapter were not drawn ahead of implementation and then hoped to match it. The Sprint 0 foundation — schema, row-level security, authorization guard, tenant-isolation test suite and continuous integration — was built and executed against PostgreSQL 16 first. The entity-relationship diagram in Section 3.5 is generated programmatically from the live database catalogue by scripts/generate-erd.mjs, so it cannot silently drift from the schema; the remaining diagrams describe code that exists and tests that pass. Where the design deliberately departs from an earlier decision, the departure and its reason are recorded in Section 3.10 rather than quietly applied.'));

add(new Paragraph({ children: [new PageBreak()] }));

// ============================== 3.1 ==========================================
add(H('3.1 Purpose and Scope of This Chapter', HeadingLevel.HEADING_1));
add(P('Chapters 1 and 2 established what the system must do. This chapter establishes how it is built: the boundary between the system and the world around it, the decomposition into components, the data model, the class structure, the behaviour of the two state machines that govern every order, and the security design that keeps one restaurant\'s data invisible to another.'));
add(P('The chapter is organised so that each section answers one question:'));
[
  '3.2 — What sits outside the system, and what crosses the boundary?',
  '3.3 — Who uses it, and for what? (traced to FR-01 … FR-21)',
  '3.4 — What are the components, and where do they run?',
  '3.5 — What is stored, and what does the database itself refuse to allow?',
  '3.6 — What are the classes, and how do they collaborate?',
  '3.7 — How does the system behave over time?',
  '3.8 — How does data move between processes and stores?',
  '3.9 — How is tenant isolation actually enforced, and how was it verified?',
  '3.10 — Which design decisions were made, and why?',
  '3.12 — Which requirements are missing, and which of them is not merely a documentation gap?',
].forEach(t => add(BULLET(t)));

// ============================== 3.2 ==========================================
add(H('3.2 System Context', HeadingLevel.HEADING_1));
add(P('The Wafa platform sits between two human audiences that never meet inside it — the customer, who only ever sees WhatsApp, and the restaurant staff, who only ever see a browser dashboard — and three external services it depends on but does not control.'));
add(figure('02-context', 'System context diagram (Level-0 data flow)'));
add(P('Three properties of this boundary shape the rest of the design. First, the customer never touches Wafa directly: every inbound and outbound message passes through Meta, which means message delivery is observable but not guaranteed by us, and is the subject of NFR-05. Second, the payment provider both receives requests and sends unsolicited confirmations, so it is an inbound webhook source with the same duplicate-delivery and signature-verification requirements as WhatsApp. Third, from 1 October 2026 every outbound message across the Meta boundary is billable, which is why the design records a per-order message counter (Section 3.5.3) rather than treating message volume as an operational detail.'));

// ============================== 3.3 ==========================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H('3.3 User Stories and Use Case Model', HeadingLevel.HEADING_1));
add(P('This section states the same requirements twice on purpose: once as user stories with acceptance criteria, which is the form the development team works from, and once as use case diagrams, which is the form that shows how the actors and their capabilities relate. Every story traces to a functional requirement in Chapter 2 — except the last three, which trace to nothing, and Section 3.12 explains why that matters.'));

add(H('3.3.1 User Stories', HeadingLevel.HEADING_2));
add(tbl(['ID', 'Story', 'Acceptance criteria', 'Traces to'],
  STORIES.map(st => [st[0], st[1], st[2], st[3]]),
  [800, 3100, 4000, 1400]));

add(CALLOUT('US-21, US-22 and US-23 trace to no functional requirement.',
  'They describe capabilities the scope and stakeholder list already imply — staff authentication, a searchable customer list, and refusing orders while the restaurant is closed — but none of the twenty-one functional requirements covers them. The third is not merely a documentation gap: the business_hours field is collected and stored, and nothing reads it. Section 3.12 sets out the proposed requirements.'));

add(H('3.3.2 Actors', HeadingLevel.HEADING_2));
add(P('Four actors interact with the system. The customer and the restaurant staff are human; the restaurant owner is a staff member with a superset of permissions; and the scheduler is an internal actor with no human behind it, which is a deliberate modelling choice because several requirements (automatic expiry, automatic cancellation, automatic refund) have no initiator at all.'));

add(H('3.3.3 Customer Use Cases', HeadingLevel.HEADING_2));
add(figure('03a-use-case-customer', 'Customer use cases — the entire customer-facing surface'));
add(Rich([
  { text: 'FR-08 is modelled as an ', },
  { text: 'extension', italics: true },
  { text: ' of cart review rather than a step within browsing, because it bypasses browsing entirely: a returning customer moves from the first message to a confirmed cart in one tap. This is the single use case that makes the 30-second reorder target in NFR-03 achievable, and it is the only capability in the system that a customer experiences as better than an aggregator rather than merely equivalent.' },
]));

add(H('3.3.4 Restaurant Use Cases', HeadingLevel.HEADING_2));
add(figure('03b-use-case-restaurant', 'Restaurant staff and owner use cases'));
add(P('The split between staff and owner is authorization, not architecture: both authenticate through the same account model, and both are subject to the same membership check on every request. A staff member of one branch has no visibility into a sibling branch of the same chain, even though a single account may legitimately hold membership in both (Section 3.9).'));

add(H('3.3.5 System-Initiated Use Cases', HeadingLevel.HEADING_2));
add(figure('03c-use-case-system', 'System-initiated behaviour — no human actor'));
add(P('These four scheduled behaviours are the reason the Conversation Engine must run continuously rather than only on demand. A deployment that suspends on inactivity does not merely delay a webhook; it silently stops expiring unclaimed orders and stops cancelling unpaid ones, which corrupts the order state over time rather than producing a visible failure.'));

add(H('3.3.6 Use Case to Requirement Traceability', HeadingLevel.HEADING_2));
add(tbl(['Use case', 'FR', 'Actor', 'Priority'], [
  ['Start session and receive menu', 'FR-05', 'Customer', 'Must'],
  ['Browse menu and build cart', 'FR-06', 'Customer', 'Must'],
  ['Review and confirm cart', 'FR-07', 'Customer', 'Must'],
  ['Reorder usual order in one tap', 'FR-08', 'Customer', 'Must (highest business priority)'],
  ['Choose pickup or delivery', 'FR-09', 'Customer', 'Must'],
  ['Choose payment method', 'FR-10', 'Customer', 'Must'],
  ['Notify customer of status change', 'FR-11', 'System', 'Must'],
  ['View live orders', 'FR-12', 'Staff / Owner', 'Must'],
  ['Accept, progress or cancel order', 'FR-13', 'Staff', 'Must'],
  ['Update customer statistics', 'FR-14', 'System', 'Must'],
  ['Process payment and refund', 'FR-15', 'System / Provider', 'Must'],
  ['Register and configure restaurant', 'FR-01', 'Owner', 'Must'],
  ['Manage menu', 'FR-02', 'Owner / Staff', 'Must'],
  ['Provision WhatsApp number', 'FR-03', 'Owner / Platform', 'Must'],
  ['Customise message templates', 'FR-04', 'Owner', 'Should'],
  ['Manage subscription', 'FR-16', 'Owner / System', 'Must'],
  ['View basic analytics', 'FR-17', 'Owner', 'Should'],
  ['View Ownership / Health Score', 'FR-18', 'Owner', 'Should'],
  ['View conversion funnel', 'FR-19', 'Owner', 'Could'],
  ['View customer timeline', 'FR-20', 'Owner', 'Could'],
  ['See at-risk customers', 'FR-21', 'Owner', 'Could'],
], [3800, 1200, 2400, 1900]));

// ============================== 3.4 ==========================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H('3.4 Architectural Design', HeadingLevel.HEADING_1));
add(H('3.4.1 Component Structure', HeadingLevel.HEADING_2));
add(P('The system is one repository containing four workspace packages: two backend modules, one frontend application, and a shared package that both sides import. The shared package is not a convenience — it is the mechanism by which a rule cannot be enforced differently in two places. The function that decides whether an order may be accepted is defined once and imported by both the server that rejects the request and the interface that disables the button.'));
add(figure('04-component', 'Component diagram'));
add(P('Two paths into the database exist, and they are deliberately asymmetric. The Dashboard API reaches data only through TenantDbService, whose connection pool is private, so no service can issue a query without a tenant context. The Conversation Engine cannot use the same entry point, because when a webhook arrives there is no authenticated staff member and therefore no restaurant yet; it resolves one from the WhatsApp phone identifier through a single narrowly scoped privileged function and then operates under exactly the same row-level security context as every other request. That function is the entire privileged surface of the engine.'));

add(H('3.4.2 Deployment', HeadingLevel.HEADING_2));
add(figure('05-deployment', 'Deployment diagram — pilot topology, with the planned split'));
add(CALLOUT('Design decision.',
  'The two backend modules are independently deployable but are deployed as a single process during the pilot. The separation is structural and preserved in the codebase; splitting it later is a configuration change, not a rewrite. The reason is concrete rather than aesthetic: free always-on hosting provides one continuously running service, and the Conversation Engine is the module that cannot tolerate suspension. Splitting the deployment now would either cost money or place one module on a tier that sleeps. The trigger for splitting is webhook load requiring different scaling characteristics from the dashboard, which is expected beyond ten restaurants — not a date.'));

// ============================== 3.5 ==========================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H('3.5 Data Design', HeadingLevel.HEADING_1));
add(H('3.5.1 Entity Relationship Diagram', HeadingLevel.HEADING_2));
add(P('The following diagram is generated from the live database catalogue, not drawn by hand. It reflects 13 tables and 18 foreign-key relationships exactly as they exist after migrations 0001 through 0003.'));
add(figure('01-erd', 'Entity relationship diagram (generated from information_schema)'));

add(H('3.5.2 Table Catalogue', HeadingLevel.HEADING_2));
add(tbl(['Table', 'Purpose', 'RLS'], [
  ['staff_accounts', 'Login identity. One account may hold membership in several restaurants of a chain.', 'No — read at login, before any tenant context can exist. Holds no tenant business data.'],
  ['restaurants', 'Tenant root. Carries chain_id, WhatsApp provisioning state, payment settings and the assumed commission rate used by FR-18.', 'Yes'],
  ['restaurant_staff', 'Membership join table. The single most security-critical table: the authorization guard reads it on every request.', 'Yes'],
  ['menu_categories', 'Menu structure, ordered and independently activatable.', 'Yes'],
  ['menu_items', 'Items with price, availability and tags. Composite foreign key guarantees an item and its category belong to the same restaurant.', 'Yes'],
  ['customers', 'Per-restaurant customer record. Unique on (restaurant_id, phone_number): the same phone number at two restaurants is two distinct customers, by design.', 'Yes'],
  ['conversation_sessions', 'Conversation state machine and cart context (jsonb).', 'Yes'],
  ['orders', 'Order header. Created at payment-method selection, never at payment confirmation.', 'Yes'],
  ['order_items', 'Line items with name and unit price snapshotted at order time.', 'Yes'],
  ['order_status_history', 'Append-only audit trail with referential integrity to the acting staff account.', 'Yes'],
  ['processed_webhook_events', 'Unified deduplication gate for both WhatsApp and payment webhooks.', 'No — written before the restaurant is resolved, including on the first message of a new conversation. Contains only opaque provider event identifiers.'],
  ['subscriptions', 'Fixed monthly billing state (FR-16).', 'Yes'],
  ['message_templates', 'Approved WhatsApp templates. A NULL restaurant_id denotes a platform default readable by all tenants and writable by none.', 'Yes'],
], [2100, 4400, 2800]));

add(H('3.5.3 Deliberate Departures from the Initial Schema', HeadingLevel.HEADING_2));
add(P('Four columns exist in the implemented schema that were not in the original design. Each was added for a reason that only became visible when the schema was executed rather than described.'));
add(tbl(['Addition', 'Reason'], [
  ['restaurant_id on order_items and order_status_history', 'Without it, the row-level security policy on these two tables becomes a correlated subquery evaluated per row, on the two tables that grow fastest. With it, the policy is an index-backed equality check. Consistency is guaranteed structurally by a composite foreign key — an orphan row carrying the wrong restaurant_id cannot be written.'],
  ['orders.ready_at', 'The 24-hour pickup expiry is defined as 24 hours from entering the ready state. Deriving that from the append-only history table would mean scanning it every 30 seconds for a timestamp that could simply be recorded.'],
  ['orders.outbound_msg_count', 'From 1 October 2026 every outbound WhatsApp message is billable. Messages per order therefore becomes an engineering constraint rather than an accounting line, and the subscription price must be set against a measured figure rather than an assumed one.'],
  ['actor + actor_staff_id replacing a single changed_by column', 'A single column holding either a UUID or a fixed string cannot carry a foreign key, which would have made the audit trail the only table in the schema without referential integrity.'],
], [3200, 6100]));

add(H('3.5.4 Constraints Enforced by the Database', HeadingLevel.HEADING_2));
add(P('Rules that can be expressed as constraints are enforced by the database rather than by application code, so that a future code path cannot violate them by omission.'));
add(tbl(['Constraint', 'Rule', 'Source'], [
  ['orders_completed_payment_settled', 'A completed order\'s payment_status must be exactly paid or collected.', 'NFR-09'],
  ['orders_collected_is_cash', 'collected is reachable only for cash orders.', 'NFR-09'],
  ['orders_cancelled_by_consistent', 'cancelled_by is set if and only if the order is cancelled.', 'FR-13'],
  ['orders_ready_at_consistent', 'ready_at exists only once the order has actually reached ready.', 'Section 3.5.3'],
  ['orders_expired_is_pickup', 'expired is reachable only for pickup orders.', 'FR-13'],
  ['osh_actor_staff_consistent', 'actor_staff_id is present exactly when the actor is staff.', 'NFR-09'],
  ['UNIQUE (event_id, source)', 'The deduplication gate. Same identifier from a different source is a distinct event.', 'NFR-04'],
  ['UNIQUE (restaurant_id, phone_number)', 'One customer record per phone number per restaurant.', 'FR-14'],
  ['UNIQUE (staff_account_id, restaurant_id)', 'One membership row per account per restaurant.', 'NFR-02'],
], [3100, 4600, 1600]));

add(H('3.5.5 Index Design', HeadingLevel.HEADING_2));
add(P('Nineteen indexes exist. Every one backs a query that appears in a sequence diagram in Section 3.7 or serves a stated non-functional target; none is speculative. Four are worth noting because they are partial indexes sized to the working set rather than to the table:'));
[
  'idx_orders_unnotified — partial on notified = false. The notification sweep runs continuously; a full index would grow with total order history rather than with the handful of unnotified rows.',
  'idx_orders_pickup_expiry — partial on status = ready AND fulfillment_type = pickup, ordered by ready_at.',
  'idx_orders_payment_timeout — partial on payment_status = pending_online, excluding terminal statuses.',
  'idx_restaurant_staff_lookup — read on every authenticated request by the authorization guard, before row-level security is enabled. If this is slow, the entire dashboard is slow.',
].forEach(t => add(BULLET(t)));

// ============================== 3.6 ==========================================
add(H('3.6 Class Design', HeadingLevel.HEADING_1));
add(H('3.6.1 Authentication and Authorization Chain', HeadingLevel.HEADING_2));
add(figure('06a-class-auth', 'Class diagram — authentication and tenant context'));
add(Rich([
  { text: 'The numbered collaboration in Figure 3.8 is the security model, and its order is the property being protected. ', },
  { text: 'AuthGuard', italics: true }, { text: ' establishes who is calling; ' },
  { text: 'RestaurantContextGuard', italics: true }, { text: ' establishes whether they may act in this restaurant; only then does ' },
  { text: 'TenantDbService', italics: true }, { text: ' establish what they can see. Performing the third step before the second would let the caller nominate their own tenant identifier, and row-level security would faithfully serve that tenant\'s data. Row-level security constrains a request to one restaurant; it has no opinion about which one. That decision is made in the guard and nowhere else.' },
]));

add(H('3.6.2 Order Management — Dashboard Side', HeadingLevel.HEADING_2));
add(figure('06b-class-orders', 'Class diagram — orders and the shared domain package'));
add(P('The menu, customers and analytics controllers are collapsed into one box here because their structure is identical to the orders path: a controller behind the two guards, a service, and the same single data path. Nothing in the API reaches the database except through TenantDbService.'));

add(H('3.6.3 Conversation Handling — Engine Side', HeadingLevel.HEADING_2));
add(figure('06c-class-conversation', 'Class diagram — webhook intake and conversation routing'));
add(P('The webhook controller calls the deduplication gate before it calls anything else, including before the restaurant is resolved. This ordering is what makes the gate effective on the very first message of a brand-new conversation, where no session exists yet to hold a reference to what has already been seen.'));

add(H('3.6.4 Order Creation and Scheduled Work', HeadingLevel.HEADING_2));
add(figure('06d-class-order-engine', 'Class diagram — order creation, outbound messaging and schedulers'));
add(P('CriticalPrimitives is modelled as a module rather than a service because it holds the four database operations on which the correctness of the system depends: the deduplication claim, the compare-and-swap state advance, the row lock, and the scheduler claim. They are collected in one place and imported, never reimplemented inline, so that a defect in any of them has one location rather than several.'));

// ============================== 3.7 ==========================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H('3.7 Behavioural Design', HeadingLevel.HEADING_1));
add(H('3.7.1 Order State Machine', HeadingLevel.HEADING_2));
add(figure('07-state-order', 'Order status state machine'));
add(P('Two distinctions in this machine carry business meaning and are deliberately not merged. An order that is cancelled had someone actively cancel it; an order that is expired sat in ready for 24 hours and was never collected. They are different events with different consequences — expired never updates customer statistics under any circumstances, because any payment on an expired order is refunded, so counting it as spend would be false. The second distinction is that the transition into accepted is gated on payment for online orders: before payment is confirmed, the only action available to staff is cancellation.'));

add(H('3.7.2 Conversation Session State Machine', HeadingLevel.HEADING_2));
add(figure('08-state-session', 'Conversation session state machine'));
add(CALLOUT('The most important property in this diagram is what it does not do.',
  'A session may be abandoned by timeout, but the order row it created is untouched. The two lifecycles are independent by design: a customer who takes an hour to complete a payment loses their conversation but not their order, and the payment confirmation updates the order regardless of session state. Conflating the two would cancel valid orders.'));

add(H('3.7.3 Activity — Placing a Cash Order', HeadingLevel.HEADING_2));
add(P('The complete path from an inbound message to an order visible on the restaurant dashboard, shown in three parts.'));
add(figure('09a-activity-cash-intake', 'Cash order (a) — webhook authentication and deduplication'));
add(figure('09b-activity-cash-route', 'Cash order (b) — tenant context, routing and cart re-validation'));
add(figure('09c-activity-cash-commit', 'Cash order (c) — atomic order creation'));
add(P('Two guards in this path defend against different duplicates and neither substitutes for the other. The deduplication gate in part (a) stops the same message being processed twice when Meta redelivers it. The compare-and-swap in part (c) stops a legitimate action being performed twice when the customer taps confirm twice — those are two genuinely distinct messages with distinct identifiers, so the deduplication gate passes both, correctly. Removing either one reopens a duplicate-order path through a different door.'));

add(H('3.7.4 Activity — Staff Status Update', HeadingLevel.HEADING_2));
add(figure('10a-activity-status-auth', 'Status update (a) — authentication, authorization and gates'));
add(figure('10b-activity-status-apply', 'Status update (b) — transactional effects'));
add(P('The refusal in part (a) returns an identical response whether the restaurant does not exist or the caller is not a member of it. Distinguishing the two would allow a caller to enumerate restaurants by comparing responses.'));

add(H('3.7.5 Sequence Diagrams for the Core Scenarios', HeadingLevel.HEADING_2));
add(figure('14-seq-webhook-gate', 'Inbound WhatsApp webhook — the unified entry gate'));
add(figure('12-seq-cash-order', 'Cash order creation'));
add(figure('13-seq-online-payment', 'Online payment through to confirmation, including the late-webhook refund path'));
add(figure('15-seq-status-update', 'Restaurant-initiated status update and the scheduled paths'));
add(figure('16-seq-proactive-reorder', 'Proactive one-tap reorder (FR-08) — the highest business priority path'));
add(figure('17-seq-payment-timeout', 'Payment timeout and the one-directional online-to-cash fallback'));
add(figure('18-seq-concurrent-cancel', 'Concurrent cancellation and payment confirmation — the refund invariant'));
add(CALLOUT('Defect found and corrected during design review.',
  'In the online payment sequence, if the payment confirmation arrives after the order has already been cancelled or expired, the refund invariant fires immediately inside the payment webhook handler rather than waiting to be noticed by the cancellation path. The earlier design depended on the cancellation path discovering the payment later, which for a payment arriving after cancellation meant it never would. This is recorded because the review that found it is part of the design method, not an embarrassment to be hidden.'));

// ============================== 3.8 ==========================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H('3.8 Data Flow', HeadingLevel.HEADING_1));
add(figure('11-dfd-level1', 'Level-1 data flow diagram'));
add(P('Process 1.0 is the only entry point for external events and performs three things in a fixed order before anything else runs: signature verification, schema validation, and the deduplication check against store D1. Process 7.0 is the equivalent gate on the staff side. Every other process operates on data that has already passed one of these two gates and is already scoped to a single restaurant.'));

// ============================== 3.9 ==========================================
add(H('3.9 Security Design', HeadingLevel.HEADING_1));
add(P('Tenant isolation is enforced by PostgreSQL row-level security rather than by application-level filtering. The distinction matters for a specific reason: application filtering requires every query to remember a WHERE clause, and a system with dozens of queries needs only one omission to disclose another restaurant\'s data. Under row-level security a forgotten predicate returns zero rows rather than another tenant\'s rows.'));
add(P('Three implementation properties are load-bearing and each is easy to break by accident:'));
[
  'The application connects using a role that is neither a superuser nor granted BYPASSRLS. A superuser bypasses every policy unconditionally, without any error, and managed database providers issue an administrative connection string by default. The application therefore checks its own role at start-up and refuses to run otherwise.',
  'The tenant context is set with a transaction-scoped setting. A session-scoped setting persists on a pooled connection and is inherited by whichever request borrows that connection next — a cross-tenant read that no single-tenant test can reproduce.',
  'The restaurant identifier is passed as a bind parameter. The SET LOCAL statement cannot take one, which is precisely why it is not used: string interpolation there would place an injection point inside the tenant boundary itself.',
];
[
  'The application connects using a role that is neither a superuser nor granted BYPASSRLS. A superuser bypasses every policy unconditionally, without any error message, and managed database providers issue an administrative connection string by default. The application checks its own role at start-up and refuses to run otherwise.',
  'The tenant context is set with a transaction-scoped setting. A session-scoped setting persists on a pooled connection and is inherited by whichever request borrows that connection next — a cross-tenant read that no single-tenant test can reproduce.',
  'The restaurant identifier is passed as a bind parameter. The SET LOCAL statement cannot accept one, which is exactly why it is not used: string interpolation there would place an injection point inside the tenant boundary itself.',
].forEach(t => add(BULLET(t)));

add(H('3.9.1 Verification', HeadingLevel.HEADING_2));
add(P('The design is verified rather than asserted. A mandatory gate of twelve assertions runs in continuous integration and blocks merges. The case it exists for is a single staff account holding an active membership in two branches of the same chain — a caller who is genuinely authorized for both, where the boundary that must hold is per-request rather than per-user.'));
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
], [700, 4900, 3700]));
add(CALLOUT('The gate is itself verified.',
  'A security test that has never been observed failing is an assertion of truth wearing a costume. A companion script deliberately breaks isolation three ways and confirms the gate turns red for each: row-level security disabled on a table, the application role granted superuser, and the tenant context set session-scoped instead of transaction-scoped. The second of these is the most common real-world failure, because it is what a managed hosting provider hands you by default.'));

// ============================== 3.10 =========================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H('3.10 Design Decisions and Rationale', HeadingLevel.HEADING_1));
add(tbl(['Decision', 'Alternative rejected', 'Rationale'], [
  ['PostgreSQL row-level security for tenant isolation', 'Application-level WHERE filtering', 'One forgotten predicate discloses another restaurant\'s data. Under RLS the same omission returns zero rows.'],
  ['NestJS', 'Express', 'The security model is an ordered sequence of guards. NestJS makes the ordering declarative and framework-enforced; in Express it is a convention a route added in another file can silently break.'],
  ['Drizzle', 'Prisma', 'Three of the four operations the system\'s correctness depends on have no native support in Prisma and would require raw SQL at exactly the points where a defect costs money. Recorded in ADR-001 with an executable proof.'],
  ['Hand-written SQL migrations', 'ORM-generated migrations', 'RLS policies, FORCE ROW LEVEL SECURITY, SECURITY DEFINER functions, CHECK constraints and partial indexes cannot be expressed in either tool\'s schema language and would be silently dropped.'],
  ['Single repository (monorepo)', 'Three repositories', 'Shared types between backend and frontend would otherwise require package publication or submodules. A change spanning schema, API and interface is one reviewable change rather than three ordered merges.'],
  ['Single deployed process during the pilot', 'Two deployed services from day one', 'Free always-on hosting provides one continuously running service, and the engine is the module that cannot suspend. The split remains a configuration change.'],
  ['Direct WhatsApp Cloud API', 'A Business Solution Provider', 'The value a BSP adds — webhook handling, inbox, interface — is exactly what this project builds itself. The earlier specification named a provider; that was a verification error, corrected in SRS v1.2.'],
  ['Order row created at payment-method selection', 'Created on payment confirmation', 'Resolves a contradiction between FR-10 and the concurrent-cancellation example, which required an order to exist at the moment a cancellation and a payment confirmation race each other — impossible under create-on-confirmation. It resolves it without introducing a new order-level status, which would have required amending FR-13\'s precondition table as well.'],
  ['Two complementary idempotency layers', 'A single mechanism', 'The event-level gate catches provider redelivery; the compare-and-swap catches a duplicate human action. These are different events and neither mechanism sees the other\'s case.'],
], [2600, 2300, 4400]));

add(H('3.11 Traceability to Detailed Design Records', HeadingLevel.HEADING_1));
add(tbl(['Record', 'Subject'], [
  ['ADR-001', 'ORM selection, with an executable verification of the four critical operations against PostgreSQL 16.'],
  ['ADR-002', 'The four schema departures documented in Section 3.5.3.'],
  ['ADR-003', 'Full technology stack review: deployment topology, polling interval scope, closed tooling choices and monitoring gaps.'],
  ['db/migrations/0001–0003', 'The authoritative schema. Figure 3.7 is generated from the database these produce.'],
  ['tests/security/chain-isolation.sql', 'The twelve assertions in Section 3.9.1.'],
  ['tests/security/negative-controls.sh', 'The three deliberate breakages that verify the gate.'],
  ['scripts/generate-erd.mjs', 'Regenerates Figure 3.7 from the live catalogue after any schema change.'],
], [2600, 6700]));

add(H('3.12 Recommended Requirement Additions', HeadingLevel.HEADING_1));
add(P('Three capabilities are implied by the scope, appear in the user stories, and in two cases are already being built — yet none is covered by any of FR-01 to FR-21. They are proposed here as formal requirements. The third is the only one that is not merely a documentation gap.'));
add(tbl(['Proposed', 'Statement', 'Current status', 'Priority'], [
  ['FR-22', 'The system shall check the restaurant\'s configured business hours before beginning an ordering flow, and shall inform the customer that the restaurant is currently closed instead of presenting the menu.',
   'NOT BUILT and not scheduled. restaurants.business_hours is collected by FR-01 and stored, but no code reads it for this purpose. A customer messaging outside opening hours is today taken through the full ordering flow, and the resulting order reaches a closed kitchen.', 'Must'],
  ['FR-23', 'The system shall authenticate restaurant staff and shall verify an active per-restaurant membership on every request before granting access to that restaurant\'s data.',
   'Built and verified (Section 3.9), but covered only by NFR-02. No functional requirement states it, so it has no acceptance criteria and no row in the traceability matrix.', 'Must'],
  ['FR-24', 'The system shall provide restaurant staff with a searchable, filterable list of the restaurant\'s customers showing order count, total spend and VIP status.',
   'Designed and scheduled for Sprint 3. FR-14 covers the underlying data and FR-20 covers a single customer\'s timeline; the list view itself has no requirement.', 'Should'],
], [1100, 3400, 3400, 1400]));
add(CALLOUT('Why FR-22 is different from the other two.',
  'FR-23 and FR-24 describe work that is happening anyway; formalising them corrects the documentation. FR-22 describes work that is not happening at all. The field exists, the interface collects it, and nothing enforces it — so the first customer to message outside opening hours receives a normal ordering experience and then a cancellation. For a pilot resting on a single restaurant, that is a poor first impression of the exact behaviour the product is trying to establish. Estimated implementation is a few hours: a business-hours check at session creation, before the menu is sent.'));

add(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'End of Chapter 3', bold: true, size: 21, font: 'Calibri' })] }));

// =============================================================================
const doc = new Document({
  creator: 'Mohammed Walid Ziada',
  title: 'Wafa — Chapter 3: System Design',
  numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.18) } } } }] }] },
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } }, children: c }],
});
Packer.toBuffer(doc).then(b => {
  fs.writeFileSync(__dirname + '/Wafa_Chapter3_System_Design_v1.1.docx', b);
  console.log('written:', (b.length / 1024 / 1024).toFixed(1) + ' MB ·', figNo, 'figures');
});
