# Off-Duty Barber — Selectable Card + Date-Aware Slot Blocking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barber cards are always clickable regardless of today's off-duty status; time slots are blocked only when the barber is off on the **selected booking date**.

**Architecture:** Remove the CSS that disables `.barber-off` cards and stop attaching the class in the render function. Slot blocking in Step 3 already uses `checkBarberOffDuty()` which queries `state.date` (the calendar date the user picked), so it is already date-aware and needs no change.

**Tech Stack:** Vanilla JS (`js/booking.js`), plain CSS (`css/booking.css`), Supabase via existing `/api/barbers/today-status` endpoint.

---

## File Map

| File | Change |
|---|---|
| `css/booking.css` | Remove `opacity/.45`, `cursor:not-allowed`, `pointer-events:none`, and `grayscale` from `.barber-off` rules |
| `js/booking.js` | Stop applying `barber-off` class and "Libur Hari Ini" badge in `renderBarberCards()` |

No new files. No new API endpoints.

---

## How the existing slot-blocking works (read before touching code)

`fetchAndRenderBarbers()` (line ~988) already fetches **today's** off-duty map into `barberOffToday`.

When the user picks a barber and advances to Step 3 (calendar), `checkBarberOffDuty()` (line ~1335) is called. It hits:

```
GET /api/barbers/today-status?date=<state.date>
```

where `state.date` is whatever date the user clicked in the calendar (could be today, tomorrow, next week). If the API returns `isWorking: false` for the selected barber **on that date**, `state.barberOffOnDate = true` is set and `buildTimeGrid()` marks every slot `.unavailable`. When the user clicks a different date where the barber IS working, `state.barberOffOnDate = false` and slots open up normally.

**This logic is already correct and must not be changed.**

---

## Task 1 — Remove the disabling CSS from `.barber-off` cards

**Files:**
- Modify: `css/booking.css` (lines 241–243)

Current lines 241–243:
```css
.pro-pick-card.barber-off{opacity:.45;cursor:not-allowed;pointer-events:none;}
.pro-pick-card.barber-off .pro-pick-img img{filter:grayscale(80%);}
.pro-pick-card.barber-off:hover{border-color:var(--w10);transform:none;}
```

- [ ] **Step 1: Replace those three lines with neutral rules**

Replace the three lines above with:

```css
.pro-pick-card.barber-off{}
.pro-pick-card.barber-off .pro-pick-img img{}
.pro-pick-card.barber-off:hover{}
```

> Keeping empty rule blocks means any future code that still emits the class won't break, and the visual state is now identical to a normal card.

- [ ] **Step 2: Verify visually**

Open `booking.html` in a browser. Go to Step 2 (Professional). A barber who is off today should now look identical to others — no grey tint, no washed-out photo, pointer is normal.

---

## Task 2 — Stop applying `barber-off` class and badge in renderBarberCards

**Files:**
- Modify: `js/booking.js` (function `renderBarberCards`, lines ~1092–1110)

Current template inside the `.map()`:
```js
const isOff = barberOffToday.has(b.id);
return `
 <div class="pro-pick-card ${state.barber?.id === b.id ? 'selected' : ''} ${isOff ? 'barber-off' : ''}" data-barber="${b.id}" data-barber-name="${b.name}" data-branch="${b.branch}">
 ${isOff ? '<div class="barber-status-badge off-duty"><span class="status-dot"></span>Libur Hari Ini</div>' : ''}
 ...
```

- [ ] **Step 1: Remove `isOff` class and badge from the card template**

Replace the two affected lines so the template reads:

```js
const isOff = barberOffToday.has(b.id);
return `
 <div class="pro-pick-card ${state.barber?.id === b.id ? 'selected' : ''}" data-barber="${b.id}" data-barber-name="${b.name}" data-branch="${b.branch}">
 ...
```

> Keep the `isOff` variable declaration — it costs nothing and avoids a lint warning. The `barberOffToday` fetch at the top of `fetchAndRenderBarbers()` can stay as-is (no harm in fetching it; it may be useful later).

- [ ] **Step 2: Confirm the click handler is unrestricted**

Locate the card click handler (line ~1124):
```js
proPickGrid.querySelectorAll('.pro-pick-card').forEach(card => {
 card.addEventListener('click', () => {
 if (card.dataset.barber === 'none') return;
```

No change needed — the handler never checked `barber-off`. Confirm this line exists and leave it unchanged.

- [ ] **Step 3: Manual test — today-off barber**

1. Open `booking.html`.
2. Go to Step 2. Pick a barber who is off today.
3. Card should select normally (red border, no grey).
4. Advance to Step 3. Pick **today** in the calendar.
5. All time slots should appear crossed out / `.unavailable`. The "barber off" warning banner should appear.
6. Now click **tomorrow** (or any date the barber works).
7. Slots should open up and be bookable.

- [ ] **Step 4: Manual test — working barber unchanged**

Pick any barber who is working today. Go through the full booking flow to confirm nothing regressed.

---

## Task 3 — Commit

- [ ] **Step 1: Stage and commit**

```bash
git add css/booking.css js/booking.js
git commit -m "feat(booking): off-duty barbers stay selectable; slots blocked on chosen date

Cards no longer go grey/disabled for barbers off today.
Slot blocking is already date-aware via checkBarberOffDuty() so
customers can still book for future dates when the barber is working."
```

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

| Requirement | Covered |
|---|---|
| Cards not grey/disabled for off-duty barbers | Task 1 CSS + Task 2 JS |
| Card remains clickable | CSS `pointer-events:none` removed; click handler untouched |
| All slots blocked when barber off on selected date | `checkBarberOffDuty()` already does this — no change needed |
| Booking works normally for future dates when barber is working | `checkBarberOffDuty()` uses `state.date`, not today |
| Applies to all kapsters in all branches | `renderBarberCards()` and `checkBarberOffDuty()` are branch-agnostic |
| No regression for working barbers | Verified in Task 2 Step 4 |
