# Automatic Tier-Based Checkout Discounts

## Problem

Paid members (Silver/Gold/Platinum) have benefits listed on their dashboard (`public/js/dashboard.js` `BENEFITS` array) — a 50% birthday discount for all three paid tiers, a 10% general service discount for Gold, and a free Gentlemen Grooming for Platinum. None of these are actually applied anywhere: `booking.html` (the site's booking form) has zero awareness of member identity or tier, and `POST /api/bookings` (`server/index.js`) trusts whatever `price` the client submits with no discount logic at all. A paying member currently has to remember their benefit and ask staff in person to apply it manually.

## Goal

When an eligible paid member books a haircut/service online, their tier discount is calculated and shown automatically in the booking summary before they submit, and the discounted price is what actually gets recorded on the booking — no manual step, no trusting client-side claims about who the member is.

## Design

### 1. Shared discount-rule module

New file `server/membership-benefits.js`, a pure function with no I/O:

```
computeServiceDiscount({ tier, membershipActive, birthdate, serviceId, location, bookingDate, basePrice })
  → { discountPercent, discountAmount, finalPrice, benefitLabel }
```

Rules (no tier inheritance — each tier gets exactly what's listed on the dashboard today; when two benefits could apply on the same booking, the one giving the larger discount wins, never stacked):

| Tier | Rule |
|---|---|
| Bronze | No automatic discount (`benefitLabel: null`, `discountPercent: 0`) |
| Silver | 50% off if `bookingDate` falls within 7 days before through 7 days after `birthdate`'s month/day (year-agnostic, handles Dec/Jan wraparound) |
| Gold | `max(` birthday 50% (same window as Silver) `,` 10% off `)` — the 10% applies to `basePrice` (already add-on-inclusive, see §4) for every service, on every branch except `location === 'csb'` |
| Platinum | `max(` birthday 50% `,` 100% off if `serviceId === 'gentleman-grooming'` `)` |

`membershipActive` (a boolean the caller computes via the existing `isActiveMembership()` helper in `server/index.js`) gates everything — an expired or never-paid membership always returns no discount regardless of `tier` value lingering in the data.

This module is a pure function (no Supabase, no `req`/`res`), which makes it the one part of this feature suited to real behavioral unit tests rather than this codebase's usual regex-on-source convention — see §6.

### 2. Server-side: `POST /api/bookings` always recomputes, never trusts the client

In `server/index.js`, before the existing `const bookingPrice = normalizeBookingPrice(...)` call:

- Skip discount logic entirely when: `isAdmin` (staff bookings are manual), `type === 'wedding'` (fixed package pricing), or the request carries a `group` flag (see §4) — in all these cases behavior is unchanged from today.
- Otherwise, look up the submitted `wa` against `member_profiles`/`customers` (reusing the existing `getMemberProfileByPhone`/`getMergedMemberCustomer` helpers already in this file) to get `current_tier`, active-membership status (via `isActiveMembership`), and `birthdate`.
- Call `computeServiceDiscount(...)` with the server-verified data (never anything from the request body) and `basePrice = normalizeBookingPrice(...)`'s result.
- Store the **final discounted price** in the existing `price` column (so every downstream consumer — Moka bridge, WA notifications, admin views, revenue reports — keeps working unmodified), plus two new columns: `original_price` (pre-discount) and `discount_label` (the human-readable benefit name, e.g. `"Diskon Gold 10%"`, or `null` when no discount applied).
- This means a member who forgot to log in before booking still gets their discount — the server looks them up by phone regardless of client-side login state.

### 3. Client-side: optimistic preview in the booking summary

In `public/js/booking.js`, on page load: if `localStorage.getItem('rb_member_token')` is set, call the existing `/api/auth/me` once and cache `{ tier: current_tier, membershipActive, birthdate }` in memory for the page's lifetime (one network call, not one per service selection).

`/api/auth/me` (`server/index.js`) needs a small fix first: its returned `customer` object currently does not carry `birthdate` at all (`current_tier` is copied from the `member_profiles` lookup, but `birthdate` isn't) — add `if (profile?.birthdate) customer.birthdate = profile.birthdate;` alongside the existing `current_tier` copy.

When the summary re-renders (`renderSummary()` / wherever `sumTotal` is set in `booking.js`), if the cached member context is present and the current booking is eligible (solo, non-wedding — mirrors the server's eligibility gate so the preview never shows a discount the server would then refuse to apply), run the same rule set client-side (duplicated logic — acceptable since these are publicly documented benefit rules, not secrets; only the *inputs*, which come from the member's own authenticated session, need to be trustworthy) and render:

- The original price with a strikethrough.
- The discounted price as the prominent total.
- A small badge with `benefitLabel` (e.g. "Diskon Gold 10%", "Diskon Ulang Tahun 50%", "Gratis — Benefit Platinum").

No discount preview shows for guests (no `rb_member_token`) — but per §2, the server still applies their discount at submit time if their phone number turns out to belong to an active member.

### 4. Scope exclusions

- **Wedding packages** (`type === 'wedding'`): excluded. Fixed package pricing, no interaction with tier discounts in this phase.
- **Group bookings** (2-person, `state.person2` in `booking.js`): excluded. The client will send an explicit `group: true` boolean on both payloads when `isGroup()` (cleaner than parsing the existing `[GROUP:...]` marker out of the `notes` text) so the server can gate on it without string-matching. Both people's prices stay full price in this phase.
- **Add-ons**: already folded into `svc.price` client-side by the existing `applyAddonsToService()` before it's ever sent to the server (confirmed by reading `booking.js`), so `basePrice` passed into `computeServiceDiscount` is already add-on-inclusive with no extra plumbing needed — this also satisfies the earlier decision that Gold's 10% should cover add-ons.
- **Admin-created bookings** (`isAdmin` request header): unaffected, staff apply any discount manually as they already do in person.

### 5. Data model

New migration `server/migrations/2026-08-10-booking-discount-columns.sql`:

```sql
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS original_price INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS discount_label TEXT;
```

Both nullable — existing rows and any booking with no applicable discount leave both `null`, and `price` keeps meaning exactly what it means today (the amount actually charged).

### 6. Customer-facing confirmation

The server-side WhatsApp confirmation sent on booking creation (`notifyCustomerBookingConfirmed`, called from within `POST /api/bookings`) gets one conditional line added when `discount_label` is set, e.g. `"🎉 Diskon Gold 10% diterapkan (harga asli Rp 95.000)"` — so the discount is visible both in the live web summary before submit and in the confirmation the customer actually receives after.

### 7. Testing

- **`server/test/membership-benefits.test.js`** (new): real behavioral unit tests calling `computeServiceDiscount` directly — no mocking, no source-regex, since this is a pure function. Covers: each tier × active/inactive membership, birthday window boundaries (exactly 7 days before/after, 8 days outside, December→January wraparound), Gold's CSB exclusion, Platinum's `gentleman-grooming`-only free benefit vs. any other service, and the max-not-stacked rule when both birthday and tier discount would apply.
- **Existing convention (regex-on-source) tests** for the wiring: `POST /api/bookings` looks up the member and calls `computeServiceDiscount` before insert, skips it for `isAdmin`/`wedding`/`group`, `/api/auth/me` now copies `birthdate` onto `customer`, `booking.js` renders the strikethrough/discount UI and gates its preview on the same non-wedding/non-group conditions as the server.
- **Manual verification**: log in as a known Gold/Platinum member (real Supabase test account), book a normal haircut, confirm the summary shows the discount before submit and the resulting `bookings` row has `original_price`/`discount_label` set correctly; book a wedding package and a group booking as the same member, confirm no discount applied in either case.

## Out of scope

- Free Iced Americano and priority-booking access (not price-affecting, not modeled here — unchanged, still handled in person).
- Any change to how wedding packages or group bookings are priced.
- New admin UI surfacing discount data beyond what's already visible via the WA confirmation and the raw `bookings` row.
- Tier inheritance (a Platinum member does not additionally get Gold's 10%, per explicit product decision).
