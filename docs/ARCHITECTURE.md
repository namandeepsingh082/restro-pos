# Architecture notes

Design decisions and the reasoning behind them. The README covers how to run the
app; this covers why it is shaped the way it is.

## 1. Integer money

Every monetary column is `Int`, holding minor units (paise). Floating point is
never used for money anywhere in the codebase.

The alternative, `Decimal`, is supported by Prisma but behaves differently across
SQLite and PostgreSQL and drags a decimal library into the client bundle for the
live cart preview. Integers behave identically everywhere, are exact under
addition, and make the pro-rata discount split a pure integer problem.

Consequence to remember: `120` in the database means ₹1.20, not ₹120.
`src/lib/money.ts` is the only place that converts.

## 2. The pricing engine is a pure function used twice

`src/lib/pricing.ts` exports `computeOrder(input)` with no imports from Prisma,
React or the network.

- The browser calls it on every keystroke to show the running total.
- `orderService.createOrder` calls it again after re-reading unit prices, tax
  percentages and add-on prices from the database.

This gives two properties that matter. First, the preview cannot drift from the
saved bill, because it is the same arithmetic on the same integers. Second, the
request body is not trusted for money: it names items, variants, quantities and
requested discounts, and the server resolves all prices itself.

### Order of operations

1. Line subtotal — `(unitPrice + addOnTotal) × qty`
2. Line discount — percent, fixed, or the whole line for a complimentary item
3. Whole-order discount, resolved against the post-line-discount total and capped
   by the coupon's `maxDiscount`
4. That discount is allocated back across lines, weighted by each line's own net
   value, using the largest-remainder method
5. Tax per line on `lineSubtotal − lineDiscount − allocatedOrderDiscount`
6. Packaging and delivery added, untaxed
7. Optional rounding of the grand total to the nearest whole unit, with the delta
   printed as `Round off`

Step 4 is the one that is easy to get wrong. Rounding each line's share
independently loses or gains a paisa on most multi-line bills, and the tax then
does not reconcile against the discount total. `allocateProportional` guarantees
the parts sum exactly to the discount.

Step 5 has to come after step 4, not before: tax on a discounted bill is charged
on what the customer actually pays.

## 3. Orders are immutable records

`OrderItem` stores `nameSnapshot`, `variantSnapshot`, `unitPrice`, `taxPct` and
`isVeg` as they were at the moment of sale.

A price change tomorrow must not rewrite yesterday's bill, and a reprint six
months later has to produce the same slip. For the same reason,
`DELETE /api/menu/items/:id` checks whether the item appears on any order line
and, if it does, disables it instead of deleting it.

Draft and held orders are the one exception: they never received a bill number,
so resuming and re-saving one deletes the original inside the same transaction
(`replacesOrderId`). This keeps the cancellation report free of orders that were
never really cancelled.

## 4. Idempotency instead of button-disabling

A double-tap on `Save & print`, a flaky connection, or an offline order replayed
twice would each create a duplicate bill. Disabling the button covers only the
first case.

Instead, the client generates a UUID per bill and sends it as `idempotencyKey`,
which is a unique column on `Order`. `createOrder` looks it up first and returns
the existing order if it is already there. The offline queue stores the key with
the payload, so a replay resolves to the same order rather than a second one.

## 5. Offline is the client's job, not the service worker's

The service worker caches the app shell and GET requests. It never touches
POST/PATCH/DELETE.

Only the page knows the idempotency key, which fields the cashier filled in, and
what to show when a write fails. A service worker replaying opaque POSTs from
Background Sync would be replaying requests it cannot reason about. So writes are
queued by the page in IndexedDB and drained by a loop in `OfflineBadge`, which is
mounted in the header on every screen.

Offline slips print from `LocalSlipPrinter`, which portals the same `Receipt`
component onto `<body>` and hides every sibling for the duration of the print, so
the roll carries the bill alone with no app chrome and no wrapper padding.

Offline bills carry a local `OFF-…` reference, not a server bill number. Handing
out sequence numbers on a disconnected device would collide as soon as two
devices did it.

## 6. Numbering resets itself

`Counter` rows are keyed `kind:scope`, where the scope is derived from the date
tokens in the format string — `bill:20260730` for a format containing `{DD}`,
`bill:202607` for `{MM}`, `bill:2026` for `{YY}`, `bill:all` for none.

A new day therefore starts a new counter simply by writing to a different key.
There is no midnight job to schedule, nothing to go wrong if the machine was off
at midnight, and the reset follows the restaurant's own timezone rather than
UTC.

Token parsing lives in `numberFormat.ts` with no database import, so the settings
screen can preview the next number in the browser without pulling Prisma into the
client bundle. `numbering.ts` holds the half that consumes a sequence value.

## 7. Reporting has one definition of a sale

`src/lib/reports.ts` is the only place that decides what counts. A sale is any
order whose status is not `DRAFT`, `HELD` or `CANCELLED`. Refunds are reported
separately and subtracted into `netSales` rather than removed from gross, which
is what an accountant expects to see.

The dashboard, the reports page and the CSV export all read the same functions,
so they cannot disagree with each other.

Hourly buckets are computed in the restaurant's timezone by measuring the offset
at each timestamp rather than assuming a fixed one, so a report spanning a DST
change still buckets correctly.

## 8. Schema portability

No database enums (SQLite has none), no `Decimal` or `Float` for money, no `Json`
columns, no native arrays. Status vocabularies live in
`src/lib/constants.ts` and are enforced by Zod at the API boundary. Small
structured payloads — line add-ons, audit metadata — are stored as JSON strings.

The migration to PostgreSQL is a provider change plus `prisma migrate deploy`,
with no column types to rewrite.

## 9. Roles in three layers

- `middleware.ts` (edge): anonymous requests are redirected to `/login`, and
  cashiers are kept out of admin pages. It reads only the signed token.
- `requirePermission()` in each route handler: the real gate, one line per route.
- `getActiveUser()` for the most sensitive writes: a fresh database read so a
  disabled account stops working immediately instead of at token expiry.

Discount ceilings are per user (`maxDiscountPct`, `maxDiscountAmt`). The billing
screen enforces them for immediate feedback and the server enforces them again,
because the screen is not the authority.

## 10. Design choices in the UI

The visual language is a cool "steel counter" neutral ramp with a petrol-teal
primary. Green and red are reserved throughout for the FSSAI veg / non-veg mark,
which is a functional signal a cook or a customer reads at a glance, not
decoration — which is why no button anywhere uses green or red except a
destructive one.

Numbers are set in a monospaced face with tabular figures so a total does not
jitter as it changes. No web font is loaded anywhere: the app has to work with
the cable pulled out, and a missing font would reflow the billing screen mid-service.

Animation is limited to nothing at all. On a busy counter, a 200 ms transition
between taps is 200 ms of uncertainty about whether the tap registered.

## Known limits

- Single outlet. Multi-branch needs a `branchId` on `Order`, `MenuItem` and
  `User`, and a branch filter in `reports.ts`.
- No stock or ingredient tracking, so "out of stock" is a manual flag.
- Packaging and delivery charges are untaxed.
- Reopening a completed bill changes its status but does not reopen it for
  editing; the intended correction path is cancel-and-rebill or a partial refund.
- Excel export is CSV with a UTF-8 BOM rather than a binary `.xlsx`, which keeps
  the app free of a spreadsheet dependency. It opens directly in Excel.
- The tax report assumes a two-way CGST/SGST split. Interstate IGST would need a
  place-of-supply field on the order.
