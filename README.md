# Restro POS

**A point-of-sale system for a single restaurant — billing, kitchen tickets,
offline service and thermal receipts — running in a real outlet.**

[![CI](https://github.com/namandeepsingh082/restro-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/namandeepsingh082/restro-pos/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Prisma](https://img.shields.io/badge/Prisma-SQLite%20%E2%86%92%20PostgreSQL-2d3748)
![PWA](https://img.shields.io/badge/PWA-offline%20billing-5a0fc8)
![Licence](https://img.shields.io/badge/licence-MIT-green)

Bills print on 58 mm and 80 mm thermal rolls, not A4. A cashier can take orders
with the network cable pulled out. The bill goes to the customer on WhatsApp as a
PDF the app writes itself. Installs to a phone's home screen as an app.

![The billing screen on a laptop](docs/screenshots/billing-laptop.png)

| Phone — menu | Phone — checkout | 80 mm receipt |
| --- | --- | --- |
| ![Menu on a phone](docs/screenshots/menu-phone.png) | ![Checkout on a phone](docs/screenshots/checkout-phone.png) | ![An 80mm receipt](docs/screenshots/receipt-80mm.png) |

---

## The parts worth reviewing

Written as a working product rather than a demo, so most of the interesting
decisions are about correctness under real-world conditions:

- **Money is never a floating-point number.** Every amount is an integer in paise
  ([`money.ts`](src/lib/money.ts)). Discounts are split across lines by the
  largest-remainder method ([`allocateProportional`](src/lib/pricing.ts)), so the
  parts sum to exactly the whole instead of losing a paisa per bill.
- **One pricing engine, two runtimes.** [`pricing.ts`](src/lib/pricing.ts) is pure
  and runs in the browser for the live preview *and* on the server to compute the
  authoritative total. The preview always equals the saved bill — and the server
  re-reads prices from the database first, so a modified payload can change what
  is ordered, never what it costs.
- **Offline billing that reconciles.** Orders queue in IndexedDB with
  client-generated idempotency keys and replay when the network returns
  ([`offline.ts`](src/lib/client/offline.ts)); a unique constraint makes a
  double-tapped save or a replayed queue physically unable to bill twice.
- **A PDF writer, by hand.** Catalog, page, image XObject and xref assembled byte
  by byte, with `CompressionStream` for `/FlateDecode`
  ([`slipExport.ts`](src/lib/client/slipExport.ts)) — the page is sized to the
  paper roll, so a bill can't come out stretched across A4. No PDF library.
- **The receipt preview *is* the paper.** The slip is a real millimetre-width
  column of monospaced text ([`Receipt.tsx`](src/components/Receipt.tsx)) shared
  by the screen, the printer and the PDF, with `@page { size: 80mm auto }` so the
  printer cuts after the last line.
- **Reporting is timezone-correct.** Days are bucketed in the restaurant's zone,
  never raw UTC ([`datetime.ts`](src/lib/datetime.ts)), with unit tests covering
  the IST rollover where 19:30 UTC is already tomorrow.
- **Bill numbers survive two cashiers.** Each is one atomic counter increment with
  per-day sequences and configurable formats ([`numbering.ts`](src/lib/numbering.ts)),
  so two phones billing simultaneously cannot collide.
- **Every sensitive action is answerable.** Discounts, voids, refunds, off-menu
  items and back-dated bills are all written to an append-only audit trail with
  the actor ([`audit.ts`](src/lib/audit.ts)), and permissions are enforced on the
  server, never only in the UI.
- **Portability is designed in, not promised.** No enums, no `Json` columns, no
  `Decimal` — so SQLite becomes PostgreSQL by changing one line
  ([`schema.prisma`](prisma/schema.prisma)).
- **One layout, phone to counter.** Lists are a single CSS grid that stacks into
  cards on a phone and snaps into aligned columns on a laptop, using `dvh` and
  safe-area insets so the last row is never under a browser toolbar or a home
  indicator.

Also here: [`deploy/`](deploy/) — provisioning, zero-downtime releases and
backups for a small always-on server, and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the reasoning behind the data model.

---

## Quick start

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#    paste that value into AUTH_SECRET in .env

# 3. create the database and load a sample menu
npm run setup          # = prisma db push && tsx prisma/seed.ts

# 4. run
npm run dev            # http://localhost:3000
```

Sign in with the seeded accounts:

| Role    | Email                       | Password      |
| ------- | --------------------------- | ------------- |
| Admin   | `admin@restaurant.local`    | `admin@123`   |
| Cashier | `cashier@restaurant.local`  | `cashier@123` |

**Change both passwords before taking a single real order.** Staff → Edit → new
password.

### Installing it as an app (iPhone, Android, laptop)

There is no separate app to build — this is a PWA. On an iPhone: open the app in
**Safari** (not Chrome — only Safari can install on iOS), then **Share → Add to
Home Screen**. It launches full-screen with its own icon, straight onto the
billing screen (`start_url`), with no address bar.

Two requirements, neither of which is a code problem:

- **HTTPS.** The service worker (offline billing) and the Web Share API (attaching
  the bill PDF to WhatsApp) are secure-context features. On `http://192.168.x.x`
  the browser does not expose them at all.
- **A production build.** `RegisterServiceWorker` deliberately does nothing in
  development, so offline only works behind `npm run build && npm start`.

Both `apple-mobile-web-app-capable` and the modern `mobile-web-app-capable` are
emitted, and `icons.apple` points at the 180×180 file — iOS ignores the manifest's
icon list, and without that link it puts a *screenshot of the page* on the home
screen.

A native App Store build buys nothing here: a wrapper would still just load this
same server in a web view, so it would behave identically while costing an Apple
Developer subscription and risking rejection under App Review guideline 4.2. The
case for going native is hardware the browser cannot reach — a Bluetooth thermal
printer driven from the phone being the realistic one.

### Production

```bash
npm run build
npm start                        # or: pm2 start npm --name restropos -- start
```

Set `NODE_ENV=production` and a strong `AUTH_SECRET`. Session cookies are marked
`secure` in production, so this **must** be served over HTTPS — over plain `http`
the browser discards the session cookie and nobody can sign in.

For a permanent URL on a server that does not depend on any laptop staying open,
see **[deploy/README.md](deploy/README.md)**: a free always-on VM, Caddy for the
certificate, pm2 for restarts, and two commands per deployment.

---

## What is built

**Phase 1 — complete**

- Email + password sign-in, sessions in a signed httpOnly cookie, admin and
  cashier roles
- Menu management: categories, items, sizes/variants, add-ons, veg/non-veg,
  per-item tax, out-of-stock and hidden flags, CSV import and export
- POS billing screen: search, category rail, cart, quantities, per-line notes,
  per-line and whole-order discounts, coupons, complimentary items
- Quick add: an item typed straight onto one bill — name, price, qty — without
  touching the menu
- Dine-in / takeaway / delivery with only the fields each type needs, plus
  packaging and delivery charges
- Cash, UPI, card, online and split payments; paid / partly paid / unpaid
- Compact 58 mm and 80 mm receipts, PDF via the browser's print dialog,
  WhatsApp share, reprint
- Daily sales dashboard and eleven reports, all exportable as CSV
- Order history with hold, resume, settle, cancel and refund

**Phase 2 — complete**

- Kitchen order tickets, including additional KOTs that print only newly added
  items
- Offline billing with an IndexedDB queue and automatic sync
- Customer records with phone lookup and address reuse
- Cash drawer open/close with expected-versus-counted reconciliation
- Audit log on every sensitive action

**Phase 3 — not built.** Multi-branch, inventory and ingredient tracking, cloud
backup and multi-device push sync are out of scope for this release. The schema
already isolates what they would touch: adding a `branchId` to `Order`,
`MenuItem` and `User` is the whole structural change multi-branch needs.

---

## Architecture

```
Browser (PWA)                          Server (Next.js)                Data
─────────────                          ────────────────                ────
Billing screen  ──── POST /api/orders ──►  orderService.createOrder ──► SQLite
  │  computeOrder()                          │  re-reads prices             or
  │  (live preview)                          │  computeOrder()          Postgres
  │                                          │  (authoritative)
  ├─ IndexedDB queue ── retry loop ──────────┘
  │
  └─ /print/bill/:id  ──► server-rendered slip ──► window.print()
```

### The rules that shape the code

**Money is never a float.** Every amount is an integer count of minor units
(paise). `src/lib/money.ts` converts only at the edges — parsing a form field
and formatting for display. This removes an entire class of one-paisa
discrepancies from the reports.

**One pricing engine, two callers.** `src/lib/pricing.ts` is a pure function.
The browser calls it to show live totals as the cashier types; the API calls it
again after re-reading unit prices, tax rates and add-on prices from the
database. The preview always matches the bill, and a tampered request can change
*what* is ordered but never *what it costs*. Whole-order discounts are spread
back across lines by the largest-remainder method so per-line tax is correct and
the parts sum exactly to the discount.

**Bills are immutable records.** Each order line snapshots the item name,
variant name, unit price and tax rate. Changing a price tomorrow does not
rewrite yesterday's bill, and a menu item that appears on any past bill is
disabled rather than deleted.

**Every write is replay-safe.** The client generates a UUID per bill and sends it
as `idempotencyKey`, which is a unique column. A double-tapped Save, a retried
request, or an offline order replayed twice all resolve to the same single order.

**Portable schema.** No database enums, no `Decimal`, no `Json` columns, no
native arrays — see the header comment in `prisma/schema.prisma`. Moving to
PostgreSQL is a provider change and a migration, with no column-type rewrites.

### Folder layout

```
prisma/
  schema.prisma          17 models, portability rules documented inline
  seed.ts                roles, users, settings, taxes, ~40-item Indian menu
scripts/
  backup.mjs             hot SQLite backup with 30-file rotation
  make-icons.mjs         generates the PWA PNGs, no image library
src/
  lib/
    pricing.ts           the pricing engine (pure, shared client + server)
    money.ts             minor-unit maths and currency formatting
    orderService.ts      authoritative order create / KOT / cancel / refund
    receipt.ts           builds the printable shape of a bill or KOT
    reports.ts           every aggregate the dashboard and reports read
    numbering.ts         bill/order/KOT sequences with automatic reset
    numberFormat.ts      token parsing, safe to import in the browser
    session.ts           JWT cookie, role and permission checks
    validation.ts        Zod schema for every API input
    audit.ts, db.ts, csv.ts, datetime.ts, settings.ts, constants.ts, api.ts
    client/              api fetch wrapper, IndexedDB offline queue, formatting,
                         slipExport.ts (slip → PNG / hand-written PDF)
  components/
    Receipt.tsx          the slip itself — used by print routes and the preview
    AppShell.tsx, OfflineBadge.tsx, PrintTrigger.tsx, PrintToolbar.tsx,
    LocalSlipPrinter.tsx, SignOutButton.tsx, RegisterServiceWorker.tsx
  app/
    billing/             POS screen (BillingScreen.tsx is the main client file)
    orders/              history, row actions, reprint, cancel, refund
    dashboard/           daily sales
    reports/             eleven reports + CSV download
    menu/                item and category management, CSV round trip
    settings/            restaurant profile, tax, printing, numbering
    users/               staff accounts and discount ceilings
    cash/                drawer open / movements / close
    print/bill/[id]      customer bill  (?w=58|80 &auto=1 &close=1 &reprint=1)
    print/kot/[id]       kitchen ticket (?batch=n)
    api/                 route handlers, one file per resource
  middleware.ts          edge gate: anonymous → /login, cashier → no admin pages
tests/
  pricing.test.ts        22 assertions on the pricing engine
  format.test.ts         25 assertions on money, numbering, CSV, timezones
```

### Billing screen layout

```
┌──────────┬──────────────────────────────────┬───────────────────────┐
│          │[ search item or code ][+Quick add]│ Dine-in|Takeaway|Deliv│
│ All      ├──────────────────────────────────┤ Table / name / phone  │
│ Starters │ ┌────────┐┌────────┐┌────────┐   ├───────────────────────┤
│ Main     │ │◆Paneer ││◆Dal    ││◆Butter │   │ ◆ Paneer Tikka  Full  │
│ Breads   │ │  260   ││  240   ││  Chick.│   │   − 2 +        520.00 │
│ Rice     │ └────────┘└────────┘└────────┘   │ ◆ Butter Naan         │
│ Beverages│ ┌────────┐┌────────┐┌────────┐   │   − 4 +        220.00 │
│ Desserts │ │  ...   ││  ...   ││  ...   │   ├───────────────────────┤
│ Combos   │ └────────┘└────────┘└────────┘   │ Packaging / Delivery  │
│          │                                  │ No disc | % | ₹ | Cpn │
│          │                                  │ Subtotal      740.00  │
│          │                                  │ Tax            37.00  │
│          │                                  │ TOTAL         777.00  │
│          │                                  │ Cash UPI Card Online  │
│          │                                  ├───────────────────────┤
│          │                                  │Clear│Hold│KOT│SAVE&PRT│
└──────────┴──────────────────────────────────┴───────────────────────┘
```

On a phone the two halves become tabs, with a bar at the bottom showing the
running total. Every tap target is at least 44–48 px.

### Phone and laptop

The same screens serve a counter laptop and a phone in a pocket. What that costs,
concretely:

- **Viewport height is `dvh`, not `vh`.** `100vh` on a phone is the window
  *without* the browser's collapsing toolbars, so a full-height app column puts
  its last row — Save & print — underneath the address bar. `.h-viewport`
  declares `vh` then `dvh`, so older browsers keep the fallback.
- **The fixed Menu/Cart bar reserves its own space.** Both columns carry
  `.pb-bottom-bar` / `.mb-bottom-bar`, which is `52–60px + env(safe-area-inset-bottom)`
  below `md` and nothing above it. Without the inset the bar sits under an
  iPhone's home indicator and takes two taps.
- **Wide tables became grids.** Orders and Menu were 860 px and 820 px tables, so
  on a phone the actions — the reason you opened the screen — sat off the right
  edge. Both are now one CSS grid: a card per row on a phone, aligned columns
  under a header from `md` up. One markup path, no second copy to keep in step.
- **Grid tracks are content-independent** (`minmax(0,Nfr)` and fixed widths, never
  `auto`). The header and each row are separate grid containers, and a track sized
  to its own content resolves differently in each — which is exactly how a header
  ends up floating half a column from the values it labels.
- **Dialogs and sheets** are `max-h-sheet` with `overflow-y-auto`, so a sheet on a
  short screen scrolls instead of pushing its buttons off the bottom.
- **`touch-action: manipulation`** on every control removes the ~300 ms tap delay
  some Android browsers still add.

Checked at 360×640, 390×844 and 1440×900 on every screen: no page scrolls
sideways, and the two that did — the date-range forms on Sales and Reports, where
two native date inputs plus a button have a ~370 px intrinsic width — now wrap.

### When a screen fails

`error.tsx` catches a throw inside any screen and offers *Try again* (which
re-renders just that segment) and a way back to billing; `global-error.tsx` covers
a failure in the root layout itself and carries inline styles, since it cannot
assume the stylesheet loaded. `not-found.tsx` handles a bill that no longer
exists. Print routes use `requirePageSession`, which redirects an expired session
to the sign-in form and returns to the slip afterwards — `requireSession` throws,
which is right for an API route and a 500 error page on a screen.

Keyboard: `/` focuses search, `Enter` on a single search result adds it, `F2`
saves and prints, `Esc` closes dialogs.

### What a bill needs

Almost nothing. **Table number, customer name and phone are optional** — a queue
of people waiting to pay must never be held up by a field. A dine-in bill saved
with no table entered gets `DEFAULT_TABLE` (`T-01`, in `BillingScreen.tsx`)
rather than being refused, so the slip, the kitchen ticket and the table column in
Orders all read the same thing and nobody has to wonder whether the field was
missed or the row is broken. A missing customer name or phone simply does not
print.

The one field still required is a **delivery address**, because a delivery order
with nowhere to go is not something anyone can act on.

### Billing a meal for an earlier time

A customer eats at lunch, comes back at night, and wants the bill to say lunch.
**Change bill time** on the checkout column (admins only) takes a date and a time
and bills the order against that moment instead of now.

What follows the chosen time: the printed slip, `createdAt`, `completedAt`, and
therefore which day the sale counts towards in the dashboard and reports. The bill
number too — a bill dated the 29th reads `INV-260729-0001` and continues *that*
day's sequence, because a slip whose number and date disagree invites the question
you least want a customer asking. Numbers stay unique regardless: each is a single
atomic increment of a per-day counter.

This is the most abusable field in the app — it decides which day's takings and
which shift's cash a sale lands in — so it is fenced in four ways:

1. **Admins only.** A cashier who could re-date a sale could move cash out of the
   shift it will be counted against. Enforced in `resolveBilledAt`, not in the UI.
2. **Never the future** (a minute of tolerance for clock skew). A future-dated
   bill would hide from every "today" report until its date arrived.
3. **Thirty days back at most.** Beyond that is not a late customer, it is someone
   rewriting a month that has already been reported.
4. **Both times are kept.** `Order.actualCreatedAt` holds the real wall-clock
   moment the row was written, and the audit log records `billedAt` alongside it
   with the admin's id. Orders shows a *time edited* chip. None of this appears on
   the customer's slip — the marker is for the owner, not the guest.

The times are read in the **restaurant's** timezone, not the device's, via the
same tested `tzOffsetMinutes` helper the reports use: `new Date('…T13:30')` would
otherwise mean 13:30 wherever the phone thinks it is.

One consequence to know: a back-dated bill leaves today's cash-drawer expectation,
because the drawer counts by `createdAt`. If you re-date a cash sale, the drawer
for the day you dated it to is the one that now expects the money.

### Quick add — an item on one bill only

For the plate the kitchen improvised and the bottle a supplier dropped off:
**+ Quick add** next to the search box takes a name, a price, a quantity, a tax
percent and veg/non-veg, and puts that line on the current bill. Nothing is
written to the menu. Searching for something that is not on the menu offers
*Quick add “…”* prefilled with what was typed, so a failed search is already
half of adding it.

The line behaves like any other from there on: it takes notes, discounts and
complimentary status, it is taxed at its own rate, it prints on the bill and on
the KOT, and it survives hold → resume (the cart row is rebuilt from the order's
own snapshot, since there is no menu row to look up). In the cart it wears a
*Quick add* chip so nobody mistakes it for a menu item. Two quick-adds with the
same name stay two rows — unlike menu taps, they are never merged.

**The one place a client price is stored as sent.** Everywhere else the server
re-reads prices from the menu and ignores what the browser claims; a quick-added
line has no menu row to read, so its name and price are taken from the payload.
That is a deliberate trade for counter speed, and it is bounded three ways: the
schema rejects a line that carries both a `menuItemId` and quick-add details (or
neither, or add-ons, or a variant); discount and complimentary limits still apply
per the cashier's ceiling; and every quick-added line is written to the audit log
under `order.quickAdd` with the cashier's id, the name, the price and the
quantity. To restrict the feature to admins, return a 403 from
`assertQuickAddAllowed` in `src/lib/orderService.ts` — that is the only change
needed.

The Tax % field prefills from **Settings → default tax rate**. If that is 0, a
quick-added item is untaxed unless the cashier types a rate.

---

## Receipt printing

The slip is a real millimetre-width column of monospaced text, so the on-screen
preview *is* the paper. The print route injects `@page { size: 58mm auto;
margin: 0 }` (or 80 mm), which is what stops the printer ejecting a blank page
after each bill.

- **Print bill** — `/print/bill/:id`
- **Reprint** — same route with `?reprint=1`, which stamps the slip
- **Getting out of the slip screen** — the toolbar ends with *New bill*, *Repeat
  bill*, *Orders* and *Close*. Close tries `window.close()` and falls back to
  `/billing`, because that only works on a window a script opened: pressing it
  must never leave a dead tab with no way back into the app.
- **Repeat bill** — `/billing?repeat=<id>` copies a finished bill's items into a
  fresh cart. Another round at the same table is one tap. The original bill is
  untouched and the new one gets its own number — unlike `?resume=`, which reopens
  a *held* bill and replaces it on save.
- **Save PDF** — a one-page PDF whose page *is* the slip: 80 mm wide
  (226.77 pt), as tall as the bill came out. This is the file to keep or send.
- **Save image** — the same slip as a PNG at 3× for legibility.
- **WhatsApp** — sends the bill PDF, not text. See below.
- **The browser's own Save as PDF** — the print dialog's *Save as PDF*
  destination lets its paper-size setting override `@page`, so the sheet may come
  out A4. The slip is capped at the roll width and centred, so that PDF holds a
  correct slip on an oversized sheet rather than a receipt stretched to 210 mm —
  but **Save PDF** avoids the question entirely.
- **Kitchen ticket** — `/print/kot/:id?batch=n`. No prices anywhere on it,
  quantity set large and first, cook's notes in bold.

### Saving a slip as a file

`src/lib/client/slipExport.ts` wraps the live slip node in an SVG
`<foreignObject>` and paints it onto a canvas, so the export is the same DOM the
printer gets — not a second layout that can drift. It pulls the `.receipt` rules
out of `document.styleSheets` rather than keeping its own copy, and skips the
`@media print` overrides, so the file is the screen slip at a fixed width. No
library and no network: the logo is already a data URL, so nothing external is
fetched and the canvas is never tainted.

The PDF is assembled byte by byte in the same file — catalog, one page, one
image XObject, xref — because a PDF renderer is a large dependency for one page
of one image, and the app has to work offline. The canvas pixels are embedded
losslessly as `/FlateDecode` RGB via `CompressionStream('deflate')`, whose zlib
framing is exactly what PDF expects; JPEG would ring around thin monospace
glyphs. Browsers without `CompressionStream` (older Safari) fall back to
`/DCTDecode` JPEG at quality 0.95. A typical 80 mm bill lands near 110 KB.

Reachable from three places: the toolbar above any slip, the *Share* button on an
order row (opens the bill without firing the printer), and the link in the green
banner right after **Save & print**.

Some Safari builds load the SVG and then draw nothing, so the canvas is checked
for being uniformly white and the button reports a failure instead of saving a
blank slip.

### WhatsApp bill — straight from the billing screen

The action row is **Clear · Hold · WhatsApp bill · Save & print**. *WhatsApp bill*
closes the sale like *Save & print* does, but instead of going to paper it renders
the slip off-screen, turns it into the same one-page PDF, and hands it to the OS
share sheet for the cashier to pick a contact. On a phone that is the whole
transaction: no printer, no second screen.

It replaced *Send to kitchen*, and it **never** prints a kitchen ticket —
regardless of the *Print the kitchen ticket automatically with every bill*
setting. An outlet that does not run tickets should not get a KOT window opening
over the share sheet, and the button exists to give the customer their bill.
Orders → **KOT** still prints one on demand for anyone who does want it, and
*Save & print* still honours the setting.

Mechanics worth knowing:

- The slip is built from the cart *before* the reset empties it, and mounted in an
  `.export-slip` div fixed at `left:-10000px`. Its own class, not `.local-slip`,
  so the print stylesheet can never put it on paper.
- Works offline. The PDF needs no network — only sending it does — so a queued
  bill can still be shared the moment there is signal.
- The wait before measuring the slip is a timer, not `requestAnimationFrame`: rAF
  stops firing when the page is hidden, and a cashier who taps this and glances at
  another app would otherwise leave the share stuck with nothing on screen to say
  so. `navigator.share` is also raced against a 45s timeout, because some
  platforms never settle it.

### Sending the bill on WhatsApp

Two rules govern this, both learned the hard way:

1. **A `wa.me` link carries text and nothing else.** No URL can attach a file to a
   chat, so the only way to *send* a PDF is the OS share sheet.
2. **`https://wa.me/` on its own is invalid** — WhatsApp answers "this link could
   not be opened". A link needs a number or a `?text=`. Every link this app builds
   therefore always carries `?text=`; with a message and no number, WhatsApp opens
   on its **contact list** and sends to whoever the cashier picks, which is what a
   walk-in customer with no saved number needs.

So **Send on WhatsApp** takes the shortest route the device offers:

1. **Tablet or phone** — the PDF goes into the OS share sheet
   (`navigator.share` with a `File`), where WhatsApp is one of the targets. One
   tap and it is sent.
2. **Desktop, or any device on a plain `http://` address** — the itemised bill
   goes as *text* and the PDF is saved for attaching by hand. There is no paste
   shortcut for a document: the clipboard holds images, not files. The chat link
   is a real anchor rather than a scripted `window.open`, because the popup
   blocker kills a `window.open` issued that long after the original click.

**The PDF can only be attached over HTTPS.** The Web Share API is a
secure-context feature: on `http://192.168.x.x:3000` browsers do not expose it at
all, so a phone on the LAN falls into case 2 and sends text only. This is not a
bug in the app and no amount of code changes it — serve the app over HTTPS (see
*Quick start → phones*) and the same button attaches the PDF. The banner says so
when it detects an insecure origin, rather than leaving the cashier to guess.

The plain-text bill from `receiptToText()` is still there as *send as text
instead*, for a customer on a slow connection who would rather have words than
a document.

### Additional KOTs

Each order line carries a `kotBatch` number, `0` until it is sent to the
kitchen. `POST /api/orders/:id/kot` stamps every unstamped line with the next
batch number and returns it, so printing a second ticket after adding two dishes
shows only those two dishes. If nothing new was added, the previous batch is
returned — a reprint rather than a blank ticket.

### Printer setup

Thermal printers are driven through the operating system's print dialog; no
driver code lives in this app.

1. Install the vendor driver (Epson TM-series, TVS, Rugtek, Xprinter and most
   ESC/POS clones all ship one for Windows and macOS; on Linux use the CUPS
   driver or `escpos` PPD).
2. In the printer's properties, set the paper size to the exact roll —
   `80 x 297 mm` / `58 x 297 mm`, or the vendor's own "Roll 80mm" entry — and set
   all four margins to 0.
3. In Chrome's print dialog, once: Destination = the thermal printer, Margins =
   None, Scale = 100 %, Headers and footers = off, Background graphics = on.
   Chrome remembers this per printer.
4. Optional, for a one-tap flow: launch Chrome with `--kiosk-printing`. The print
   dialog is then skipped entirely, and `Save & print` sends the slip straight to
   paper.

Bluetooth pocket printers usually appear as ordinary system printers once
paired, and work the same way.

If bills come out with a wide left margin, the paper size in step 2 is still set
to A4. If a blank slip feeds after every bill, margins are not 0.

---

## Offline billing

The app is installable (Chrome → *Install app*, Safari → *Add to Home Screen*)
and keeps taking orders with the network down.

- Bills are written to IndexedDB with the idempotency key they were created with
- The slip still prints: it is rendered in the browser from the same `Receipt`
  component the server uses, and marked with a local `OFF-…` reference
- A retry loop drains the queue when the browser fires `online`, when the tab
  regains focus, and every 30 seconds
- The header shows *Offline* and *n to sync*; signing out with unsynced bills
  asks for confirmation first

What offline mode deliberately does **not** do: allocate server bill numbers.
An offline slip carries a local reference, and the permanent bill number is
assigned when the order syncs. Two devices billing offline at the same counter
can therefore not produce a duplicate bill number.

---

## Security

- Passwords hashed with bcrypt (cost 10). Plain text is never stored or logged.
- Sessions are HS256 JWTs in an httpOnly, SameSite=Lax cookie; `secure` in
  production. `AUTH_SECRET` is validated at startup and must be ≥ 24 characters.
- Role checks run in three places: `middleware.ts` for page access,
  `requirePermission()` in each route handler, and a fresh database read for the
  most sensitive writes so a disabled account stops working immediately.
- Every API input is parsed with Zod. Unknown fields are dropped.
- Cashiers have a per-account discount ceiling (percent and amount); complimentary
  items and whole-order comps require an admin.
- Cancel and refund require a typed reason and are recorded in `AuditLog` with
  the actor, the amount and the reason.
- No card numbers are stored. The `Payment.reference` field is for a UPI
  reference or the last four digits of a card, and that is all it should hold.
- Cashiers can only open bills raised at their own counter.

## Backups

```bash
npm run backup      # ./backups/restropos-<timestamp>.db, keeps the last 30
```

Uses SQLite's `.backup` command when the `sqlite3` CLI is present, so it is safe
to run while the counter is busy. On PostgreSQL it prints the matching `pg_dump`
command. Put it on a cron job:

```
0 23 * * *  cd /path/to/restro-pos && /usr/bin/npm run backup
```

## Moving to PostgreSQL

1. `provider = "postgresql"` in `prisma/schema.prisma`
2. `DATABASE_URL="postgresql://user:pass@host:5432/restropos?schema=public"`
3. `npx prisma migrate deploy` (or `db push` for a fresh database)
4. `npm run db:seed` if this is a new install

No column types change. Existing SQLite data can be moved with
`pgloader sqlite://./prisma/dev.db postgresql://…`.

---

## Reference

### Environment variables

| Variable                | Required | Purpose                                    |
| ----------------------- | -------- | ------------------------------------------ |
| `DATABASE_URL`          | yes      | `file:./dev.db` or a PostgreSQL URL        |
| `AUTH_SECRET`           | yes      | Session signing key, ≥ 24 random characters |
| `SESSION_HOURS`         | no       | Session lifetime, default 12               |
| `SEED_ADMIN_EMAIL`      | no       | Seed only                                  |
| `SEED_ADMIN_PASSWORD`   | no       | Seed only                                  |
| `SEED_CASHIER_EMAIL`    | no       | Seed only                                  |
| `SEED_CASHIER_PASSWORD` | no       | Seed only                                  |

### Scripts

| Command             | Does                                             |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Development server                               |
| `npm run build`     | `prisma generate` then a production build        |
| `npm start`         | Serve the production build                       |
| `npm run setup`     | Create the schema and seed it                    |
| `npm run db:push`   | Apply the schema without a migration file        |
| `npm run db:migrate`| Create and apply a migration                     |
| `npm run db:studio` | Browse the data in Prisma Studio                 |
| `npm run db:seed`   | Load roles, users, settings and the sample menu  |
| `npm run backup`    | Timestamped database backup                      |
| `npm test`          | Pricing, money, numbering, CSV and timezone tests |
| `npm run typecheck` | `tsc --noEmit`                                   |

### API

| Method | Route                        | Who     |
| ------ | ---------------------------- | ------- |
| POST   | `/api/auth/login`            | public  |
| POST   | `/api/auth/logout`           | signed in |
| GET    | `/api/menu`                  | signed in |
| POST   | `/api/menu/items`            | admin   |
| PATCH  | `/api/menu/items/:id`        | admin   |
| DELETE | `/api/menu/items/:id`        | admin (disables if the item has history) |
| POST   | `/api/menu/categories`       | admin   |
| PATCH  | `/api/menu/categories/:id`   | admin   |
| DELETE | `/api/menu/categories/:id`   | admin (refuses if not empty) |
| GET    | `/api/menu/export`           | admin   |
| POST   | `/api/menu/import`           | admin   |
| GET    | `/api/orders`                | signed in (cashiers see their own day) |
| POST   | `/api/orders`                | signed in, idempotent |
| GET    | `/api/orders/:id`            | signed in |
| PATCH  | `/api/orders/:id`            | signed in (status) |
| POST   | `/api/orders/:id/payments`   | signed in |
| POST   | `/api/orders/:id/kot`        | signed in |
| POST   | `/api/orders/:id/cancel`     | admin / permitted |
| POST   | `/api/orders/:id/refund`     | admin   |
| GET    | `/api/customers?phone=`      | signed in |
| GET/PUT| `/api/settings`              | read: signed in, write: admin |
| GET    | `/api/reports`               | admin   |
| GET    | `/api/reports/export?report=`| admin   |
| GET/POST| `/api/cash`                 | signed in |
| GET/POST| `/api/users`                | admin   |
| PATCH  | `/api/users/:id`             | admin   |

All responses are `{ ok: true, data }` or `{ ok: false, error }`.

### Bill number formats

Configured in Settings. Tokens `{YYYY} {YY} {MM} {DD} {SEQ} {SEQ:n}`.

| Format                     | Produces        | Resets  |
| -------------------------- | --------------- | ------- |
| `INV-{YY}{MM}{DD}-{SEQ:4}` | `INV-260730-0001` | daily   |
| `{YY}{MM}/{SEQ:5}`         | `2607/00042`    | monthly |
| `{SEQ:6}`                  | `000042`        | never   |

### Tax

Taxes are exclusive and computed per line on the post-discount value, which is
what GST requires. A bill mixing 5 % and 18 % items prints one row per rate.
`Print tax as CGST + SGST halves` in Settings splits each rate into two lines.
Packaging and delivery charges are not taxed in this build; to change that, add
them into `taxableAmount` in `computeOrder`.

---

## Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| `AUTH_SECRET is missing or too short` | `.env` not created, or the value is under 24 characters |
| Bill prints on A4 with big margins | Printer paper size is not set to the roll; margins not None |
| A blank slip feeds after every bill | Page margins are not 0 in the printer properties |
| Print window does not open | Pop-ups blocked for this site — allow them, or use Reprint from Orders |
| `That coupon code is not valid` | The code does not exist, is inactive, or is outside its date range |
| Discount rejected for a cashier | Above that account's ceiling — raise it in Staff, or have an admin apply it |
| Offline badge stuck on *n to sync* | An order was rejected on the server (deleted item, discount over the limit). It stays queued so it is not lost silently — check the server log |
| Sales figures look low | Held, draft and cancelled orders are excluded from sales by design |

## Licence

Use it, change it, run your restaurant on it.
