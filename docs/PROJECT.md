# PROJECT.md — Restomate

> Product specification for Restomate. This file describes **what** we are building and **why**.
> For **how** to build it (stack, architecture, conventions, rules), see `CLAUDE.md`.

---

## 1. Overview

**Restomate** is a multi-tenant SaaS that gives restaurants one place to run service: POS, orders, kitchen tickets, tables, reservations, staff, payments and reports. Each restaurant also gets its own branded customer site for QR and online ordering.

### Problem
Small and mid-sized restaurants juggle separate tools (or paper) for orders, kitchen, reservations and payments. Orders get lost between table and kitchen, tables sit idle, payments are hard to reconcile, and owners have no clear view of sales or staff performance.

### Goal
A restaurant can sign up, set up its menu and tables, and take its first order in **under 30 minutes**, and then run its full daily service from Restomate.

### Target customers
- Independent restaurants and cafés (1 location)
- Small chains (2–20 locations) that need a shared menu with per-location control
- Quick-service and dine-in formats (the order flow must support both)

### Success metrics
| Metric | Target (first 6 months after launch) |
|---|---|
| Signup → first order placed | ≥ 40% of new tenants within 7 days |
| Time from signup to first order | Median < 30 min |
| Trial → paid conversion | ≥ 15% |
| Order → kitchen ticket latency | < 2 s (p95) |
| Monthly tenant churn | < 4% |

---

## 2. Users and personas

| Persona | Surface | Main jobs |
|---|---|---|
| **Owner** | Restaurant admin | Set up restaurant, menu, branding, staff, plan; read reports |
| **Manager** | Restaurant admin | Run a shift, manage tables and reservations, handle voids/discounts, schedules |
| **Cashier** | Restaurant admin (POS) | Take orders, print bills, take payments, split bills |
| **Waiter** | Restaurant admin (POS, tablet/phone) | Take table orders, send to kitchen, track table status |
| **Kitchen staff** | Restaurant admin (KDS) | See tickets, mark items in progress / ready |
| **Guest** | Customer site | Browse menu, order from table via QR, order online, book a table |
| **Platform admin** | Super admin | Manage tenants, packages, billing, platform settings |
| **Prospective restaurant** | Frontend (signup) | Learn about Restomate, try the demo, sign up |

---

## 3. Surfaces

| # | Surface | Who | Purpose |
|---|---|---|---|
| 1 | **Restaurant admin** | Owners and staff | POS, menus, KDS, staff, and day-to-day operations |
| 2 | **Super admin** | Restomate team | Tenants, packages, billing, and platform settings |
| 3 | **Customer site** | Guests | Public menu and ordering (example tenant: **Demo Restaurant**) |
| 4 | **Frontend (signup)** | Prospective restaurants | Public page where new restaurants join the SaaS |

Details on routing and access rules for each surface are in `CLAUDE.md` → *App surfaces*.

---

## 4. Feature specifications

Each feature lists its purpose, the main user stories and the acceptance criteria that define "done". Priority: **P0** = MVP, **P1** = launch, **P2** = after launch.

### 4.1 Menu Management — P0
Add, update and manage the menu across all locations in real time.

**User stories**
- As an owner, I can create categories, items, variants (e.g. size) and modifier groups (e.g. extra cheese, spice level).
- As an owner, I can share one menu across locations and override price or availability per location.
- As a manager, I can mark an item as sold out for today, and it disappears from the POS and the customer site immediately.

**Acceptance criteria**
- [ ] Items have name, description, image, price, tax rate, variants, modifier groups (min/max selections), dietary tags, and a published flag.
- [ ] Per-location overrides for price, availability and sold-out status.
- [ ] Changes appear on POS and customer site within 2 seconds without a page reload.
- [ ] Reordering categories and items by drag and drop.
- [ ] Editing an item never changes the price or name on past orders.

### 4.2 Order Management — P0
Track orders from table to kitchen, reducing delays and errors.

**User stories**
- As a waiter, I can open an order for a table, add items with modifiers and notes, and send it to the kitchen.
- As a manager, I can see all open orders for my location on a live board, filtered by channel (dine-in, takeaway, QR, online) and status.
- As a manager, I can void an item or order with a reason.

**Acceptance criteria**
- [ ] Order statuses follow: placed → accepted → preparing → ready → served → completed (or cancelled).
- [ ] Items can be added to an already-sent order; only the new items go to the kitchen.
- [ ] Voids require the `orders.void` permission and a reason, and are recorded in the order history.
- [ ] Live board updates in real time and recovers after a lost connection.
- [ ] Every status change records who did it and when.

### 4.3 Table Reservations — P1
Optimize seating with a reservation system for a smooth booking experience.

**User stories**
- As a guest, I can book a table on the customer site by choosing date, time and party size.
- As a manager, I can see reservations on a timeline per area, confirm, seat, or mark no-show.
- As an owner, I can set booking rules: time slots, slot length, max party size, lead time, blackout dates.

**Acceptance criteria**
- [ ] Only slots with a suitable free table are offered to guests.
- [ ] Guests receive a branded confirmation email (sent through Resend) with a cancel link; SMS/WhatsApp later.
- [ ] Seating a reservation marks the table occupied and can open an order directly.
- [ ] No-shows are tracked per customer.
- [ ] Double-booking the same table for overlapping times is impossible.

### 4.4 POS System — P0
Process orders and payments with a reliable, integrated POS.

**User stories**
- As a cashier, I can take a takeaway or dine-in order quickly with a touch-friendly grid of categories and items.
- As a cashier, I can apply a discount (if permitted), print the bill, and take payment.
- As a cashier, I can split a bill by item or by equal shares.

**Acceptance criteria**
- [ ] Works well on a 10" tablet and a desktop touch screen.
- [ ] Adding an item to the cart takes at most two taps (one if it has no required modifiers).
- [ ] Discounts (percentage or fixed, per item or per bill) require `pos.discount`.
- [ ] Shows a clear offline/reconnecting state; never silently loses a cart.
- [ ] Keyboard shortcuts for frequent actions on desktop.

### 4.5 Kitchen Order Tickets (KOT) and Kitchen Display — P0
Send orders directly to the kitchen for precision and faster service.

**User stories**
- As kitchen staff, I see new tickets appear instantly on the kitchen display, grouped by station (e.g. grill, bar).
- As kitchen staff, I can mark an item or a whole ticket as in progress or ready.
- As a waiter, I'm notified when a table's items are ready.

**Acceptance criteria**
- [ ] Ticket shows table/order number, items, modifiers, notes, and time since placed.
- [ ] Tickets turn amber and then red when they pass configurable time thresholds.
- [ ] Items route to stations based on category settings.
- [ ] KOTs can also be printed on a kitchen printer.
- [ ] Order → ticket visible in under 2 seconds (p95).

### 4.6 In-Depth Reports — P1
Detailed reports on sales, staff performance and customer trends.

**Acceptance criteria**
- [ ] Sales by day, hour, item, category, location, channel and payment method.
- [ ] Staff performance: orders taken, sales, voids, discounts given.
- [ ] Table turnover and average dining time; reservation no-show rate.
- [ ] Customer trends: new vs returning, top customers, average order value.
- [ ] Outstanding and partial payments.
- [ ] Date range picker, location filter, comparison with the previous period.
- [ ] Export to CSV. Reports require `reports.view`.

### 4.7 QR Code Menu & Orders — P0
Contactless menu browsing and ordering through QR codes.

**User stories**
- As a guest, I scan the QR on my table, see the menu, add items, and place an order linked to my table.
- As a manager, I can download and print QR codes for every table.
- As a manager, I can choose whether QR orders go to the kitchen automatically or need staff approval first.

**Acceptance criteria**
- [ ] Each table has its own QR code; codes can be regenerated if misused.
- [ ] QR orders appear on the live order board and (based on settings) on the KDS.
- [ ] Guests can see their order status and call a waiter / request the bill.
- [ ] Optional pay-at-table online payment.
- [ ] Works on any phone browser without installing an app.

### 4.8 Payment Integration — P1
Accept payments securely through **DOKU**, Indonesia's payment gateway, with every popular local method on one hosted checkout page: QRIS, bank virtual accounts (BCA, Mandiri, BRI, BNI and others), e-wallets (OVO, DANA, ShopeePay, LinkAja), credit/debit cards and paylater.

**User stories**
- As an owner, I connect my restaurant's own DOKU merchant account in Settings, test it in sandbox, then switch it to live.
- As a guest, I pay for my QR or online order on DOKU's checkout page with the method I prefer, and my order updates to "paid" automatically.
- As a cashier, I can show a DOKU QRIS code or send a payment link for a table's bill instead of taking cash.

**Acceptance criteria**
- [ ] Each restaurant connects its own DOKU account (Client ID + Secret Key) from Settings; the money goes straight to the restaurant, not through Restomate.
- [ ] DOKU supported at launch; adding another gateway later needs no changes outside the payments module.
- [ ] Online payments on the customer site and pay-at-table.
- [ ] A payment becomes "paid" only after a verified DOKU notification (or a status check), never just because the guest was redirected back.
- [ ] Unpaid DOKU payment links expire (default 60 minutes) and the order shows "payment expired" with a retry button.
- [ ] Refunds (full and partial) from the admin, requiring `payments.refund`.
- [ ] Gateway events are processed exactly once, even if delivered twice.

### 4.9 Staff Management with Permissions — P0 (roles) / P1 (schedules)
Set permissions, assign roles and manage schedules.

**Acceptance criteria**
- [ ] Invite staff by email; they set their own password.
- [ ] Default roles: Owner, Manager, Cashier, Waiter, Kitchen. Owners can create custom roles from a permission checklist.
- [ ] Staff can be limited to specific locations.
- [ ] Optional quick PIN login on shared POS devices.
- [ ] Weekly shift schedule per location; staff see their own shifts.
- [ ] Deactivating a staff member signs them out everywhere.

### 4.10 Table Management — P0
Track table availability, assignments and turnover.

**Acceptance criteria**
- [ ] Visual floor plan per area with drag-and-drop table placement.
- [ ] Table states: available, reserved, occupied, needs cleaning — color coded and live.
- [ ] Assign a waiter to a table; move an order to another table; merge tables.
- [ ] Each table shows time seated and current bill total.

### 4.11 Area Management — P0
Organize seating by zones (e.g. Indoor, Terrace, Rooftop, Private room).

**Acceptance criteria**
- [ ] Create, rename, reorder and disable areas per location.
- [ ] Tables belong to exactly one area.
- [ ] Reservations and reports can be filtered by area.

### 4.12 Bill Printing — P0
Quick, professional bill printing at checkout.

**Acceptance criteria**
- [ ] Prints on 80 mm and 58 mm thermal printers and on A4.
- [ ] Bill shows logo, restaurant details, tax ID, items, modifiers, taxes, discounts, service charge, total, payments and balance due.
- [ ] Footer text and logo configurable in Settings.
- [ ] Reprint any past bill; reprints are marked "Duplicate".

### 4.13 Payment Tracking — P0
Monitor all payments in real time, including pending and partial payments.

**Acceptance criteria**
- [ ] Bill payment status: unpaid, partially paid, paid, refunded.
- [ ] Multiple payments per bill with mixed methods (cash, card, online, other).
- [ ] Live payments list filterable by status, method, date and staff.
- [ ] End-of-day cash-up: expected vs counted cash per method, with a variance note.

### 4.14 Customer Management — P1
Build loyalty with a customer database storing preferences and feedback.

**Acceptance criteria**
- [ ] Customer profile: name, phone, email, visit history, total spend, preferences, allergies, notes.
- [ ] Customers are created automatically from reservations and online orders.
- [ ] Post-visit feedback with rating and comment; low ratings are flagged to the manager.
- [ ] Simple loyalty: points per amount spent, redeemable as a discount (P2).
- [ ] Customers can ask for their data to be deleted.

### 4.15 Customizable Customer Order Site — P0
Each restaurant gets a branded order site.

**Acceptance criteria**
- [ ] Available at `{slug}.restomate.app` from the moment the restaurant signs up.
- [ ] Custom domain support (P1, on plans that include it).
- [ ] Pages: menu, item detail, cart, checkout, order status, reservations, about/contact.
- [ ] Location picker for multi-location restaurants; respects opening hours.
- [ ] Mobile Lighthouse performance score ≥ 90.

### 4.16 Theme & Brand Customization — P1
Customizable themes and branding, from logo placement to color schemes.

**Acceptance criteria**
- [ ] Upload logo and cover image; choose primary/accent colors, font pair, and light/dark style.
- [ ] Choose from at least 3 layout presets for the customer site.
- [ ] Live preview before publishing.
- [ ] Branding also applies to printed bills and confirmation emails.
- [ ] Color choices that fail contrast checks show a warning.

---

## 5. Platform features

### 5.1 Super admin — P0 (tenants, packages) / P1 (billing, settings)

**Tenants**
- [ ] List and search restaurants with plan, status, signup date, locations, last activity.
- [ ] Tenant detail: usage against plan limits, subscription history, owner contact.
- [ ] Suspend / reactivate a tenant (suspended tenants see a notice; their customer site shows "temporarily unavailable").

**Packages**
- [ ] Create and edit plans: name, monthly/yearly price, currency, trial days, limits, included features.
- [ ] Archive a plan without affecting tenants already on it.

**Billing**
- [ ] Restaurants pay their Restomate subscription through Restomate's own DOKU account; invoices are emailed (Resend) with a DOKU payment link.
- [ ] Reminder emails before the due date and on failure; tenant moves to "past due" after a grace period (default 7 days), then read-only.
- [ ] View subscriptions, invoices, failed payments and upcoming renewals.
- [ ] Change a tenant's plan, extend a trial, or add a manual credit.

**Platform settings**
- [ ] Default currencies, tax presets, enabled payment gateways, email templates, maintenance banner, enable/disable public signup.
- [ ] Every super admin action is recorded in an audit log.

### 5.2 Frontend (signup) — P0

**Pages:** Home, Features, Pricing, Demo (links to Demo Restaurant), Login, Signup, Terms, Privacy.

**Signup and onboarding flow**
1. Enter name, email, password → verify email
2. Restaurant name and web address (`slug`) → availability checked live
3. First location: address, currency, timezone, tax settings
4. Branding: logo and colors (can skip)
5. Optional quick start: create sample menu and tables
6. Choose a plan or start the free trial
7. Land in the restaurant admin with a setup checklist (add menu, add tables, print QR codes, invite staff, take a test order)

**Acceptance criteria**
- [ ] Whole flow completes in under 5 minutes.
- [ ] A failed step never leaves a half-created restaurant.
- [ ] Pricing page always matches the active packages in the super admin.

---

## 6. Plans (proposed)

Prices are placeholders, to be decided.

| | **Starter** | **Growth** | **Pro** |
|---|---|---|---|
| Price (IDR / month) | TBD | TBD | TBD |
| Locations | 1 | 3 | Unlimited |
| Staff accounts | 5 | 25 | Unlimited |
| Tables | 20 | 100 | Unlimited |
| POS, orders, KDS, tables, areas, bill printing, payment tracking | ✓ | ✓ | ✓ |
| QR menu & ordering | ✓ | ✓ | ✓ |
| Branded customer site (subdomain) | ✓ | ✓ | ✓ |
| Online payment integration | — | ✓ | ✓ |
| Reservations | — | ✓ | ✓ |
| Customer management & feedback | — | ✓ | ✓ |
| Custom roles & staff schedules | — | ✓ | ✓ |
| In-depth reports & CSV export | Basic | ✓ | ✓ |
| Theme customization | Basic | ✓ | ✓ |
| Custom domain | — | — | ✓ |
| Loyalty program | — | — | ✓ |
| Free trial | 14 days | 14 days | 14 days |

---

## 7. Key user flows

**Dine-in with waiter**
Guest seated → waiter opens order on table → items sent to kitchen (KOT) → kitchen marks ready → waiter serves → bill printed → payment (single, split or partial) → table set to "needs cleaning" → available.

**QR order at the table**
Guest scans QR → browses menu → places order → (optional staff approval) → KOT → served → guest requests bill or pays online → table closed.

**Online order (pickup)**
Guest visits customer site → chooses location → orders and pays online → order appears on live board → kitchen prepares → marked ready → guest notified → picked up.

**Reservation**
Guest books on customer site → confirmation sent → manager sees it on the timeline → guest arrives → seated (table occupied, order opened) → normal dine-in flow.

**New restaurant**
Visits frontend → tries Demo Restaurant → signs up → onboarding → trial starts → setup checklist → first order.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | POS actions respond in < 200 ms; kitchen tickets appear in < 2 s (p95); customer site mobile Lighthouse ≥ 90 |
| Availability | 99.9% monthly target for POS, KDS and customer site |
| Connectivity | POS and KDS handle unstable Wi-Fi: clear offline state, automatic reconnect, no lost carts. Full offline mode is P2. |
| Security | Strict tenant data isolation; bot protection and rate limits on public pages; signed payment webhooks; audit log of sensitive actions |
| Privacy | No card data stored by Restomate; customer data deletable on request; no guest personal data in analytics |
| Devices | Latest Chrome, Safari, Edge; iPad and Android tablets for POS/KDS; any modern phone for the customer site |
| Accessibility | WCAG 2.1 AA on the customer site and signup frontend; large touch targets on POS/KDS |
| Localization | Currency, tax and timezone per location; launch defaults IDR and Asia/Jakarta; English and Bahasa Indonesia at launch |
| Email delivery | All email via Resend from a verified sending subdomain; auth emails delivered within 1 minute; failed sends logged and retryable |

---

## 9. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **M0 — Foundation** | Auth, organizations, locations, roles and permissions, Demo Restaurant seed, CI | A user can sign up, create a restaurant, invite a staff member with a role |
| **M1 — Signup & super admin basics** | Frontend pages, onboarding flow, tenants list, packages | New restaurant onboards end to end; platform admin sees it and its plan |
| **M2 — Venue & menu** | Areas, tables, floor plan, menu management, QR code generation | Restaurant can fully set up menu and floor plan |
| **M3 — Service core (MVP)** | POS, order management, KOT and KDS, bill printing, cash payments, payment tracking | A full dine-in service can run on Restomate with cash |
| **M4 — Customer site** | Branded customer site, QR ordering, online pickup orders | Guests order from table and online at Demo Restaurant |
| **M5 — Payments** | DOKU Checkout (QRIS, VA, e-wallets, cards), split/partial payments, refunds, pay-at-table, status reconciliation | Online payments reconcile correctly in DOKU sandbox and production |
| **M6 — Launch** | Reservations, customer management, reports, staff schedules, theme customization, super admin billing and plan enforcement | Public launch with paid plans |
| **M7 — After launch** | Custom domains, loyalty, SMS/WhatsApp notifications, offline mode, direct thermal printing, inventory | — |

---

## 10. Out of scope (for now)

- Inventory and recipe costing
- Third-party delivery app integrations
- Accounting software sync
- Native mobile apps (the web app is responsive)
- Hardware sales

---

## 11. Open questions

### Decided
- **Payment gateway:** DOKU (DOKU Checkout) for guest payments; each restaurant uses its own DOKU merchant account.
- **SaaS billing:** Restomate bills restaurants through **its own DOKU account** (monthly invoice paid via DOKU Checkout; card auto-debit is a later option).
- **Email:** Resend. Supabase Auth emails through Resend SMTP; all other emails through the Resend API.
- **Launch market and currency:** Indonesia, IDR. Tax defaults to the regional restaurant tax (PB1/PBJT, configurable per location) plus optional service charge.

### Still open
1. **Plan pricing:** IDR prices for Starter / Growth / Pro, and whether a yearly discount is offered.
2. **DOKU onboarding for restaurants:** do we help restaurants open a DOKU merchant account (referral / sub-account), or do they bring their own?
3. **Notifications:** email only at launch, or WhatsApp from day one (very common in Indonesia)?
4. **POS hardware:** which receipt printers and cash drawers must be supported at launch?
5. **Tipping:** needed at launch, in addition to service charge?
6. **E-Faktur / tax invoices:** do any target restaurants need PPN tax invoices on Restomate's subscription bills?

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Tenant / organization** | One restaurant business using Restomate (may have several locations) |
| **Location** | One physical branch of a restaurant |
| **Area** | A seating zone inside a location (e.g. Terrace) |
| **KOT** | Kitchen Order Ticket: the list of items sent to the kitchen for an order |
| **KDS** | Kitchen Display System: the screen kitchen staff use to see and update tickets |
| **POS** | Point of Sale: the screen used to take orders and payments |
| **Package / plan** | A Restomate subscription tier with limits and features |
| **Customer site** | The branded public ordering site each restaurant gets |
| **Demo Restaurant** | The seeded example tenant used for demos and tests |
| **DOKU** | Indonesian payment gateway used for guest payments and Restomate subscription billing |
| **QRIS** | Indonesia's national QR payment standard, payable from any bank or e-wallet app |
| **PB1 / PBJT** | Indonesian regional tax on restaurant food and drink |
| **Resend** | Email delivery service used for all Restomate email |
