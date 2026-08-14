from pathlib import Path

p = Path('server/moka/sync.js')
s = p.read_text()

old_reactivate = '''    if (existing.status === 'cancelled') {
      patch.status = 'reserved';
      patch.notes  = null;
    }
'''

new_reactivate = '''    if (existing.status === 'cancelled') {
      // Do not resurrect an ancient Open Bill that stale cleanup intentionally
      // cancelled. Moka can keep forgotten PENDING bills for days; reviving one
      // on every pull both re-blocks old slots and can create an invalid range
      // when duration correction is based on a stale createdAt timestamp.
      const staleCutoffMs = Date.now() - MOKA_OPENBILL_STALE_HOURS * 60 * 60 * 1000;
      if (endTime.getTime() > staleCutoffMs) {
        patch.status = 'reserved';
        patch.notes  = null;
      } else {
        console.log(`[Sync] Open bill ${billId} remains cancelled: computed end ${endTime.toISOString()} is older than stale window`);
      }
    }

    const canPatchTiming = existing.status !== 'cancelled' || patch.status === 'reserved';
'''

if old_reactivate not in s:
    raise SystemExit('Expected stale-reactivation block not found; refusing unsafe patch')
s = s.replace(old_reactivate, new_reactivate, 1)

s = s.replace('''    if (parsedStart) {
      const existingMs = new Date(existing.start_time).getTime();''', '''    if (canPatchTiming && parsedStart) {
      const existingMs = new Date(existing.start_time).getTime();''', 1)

s = s.replace('''    if (!patch.end_time) {
      const existingEndMs = new Date(existing.end_time).getTime();''', '''    if (canPatchTiming && !patch.end_time) {
      const existingEndMs = new Date(existing.end_time).getTime();''', 1)

s = s.replace('''    if (!patch.end_time) {
      const existingEndMs = new Date(existing.end_time).getTime();''', '''    if (canPatchTiming && !patch.end_time) {
      const existingEndMs = new Date(existing.end_time).getTime();''', 1)

needle = '''    if (Object.keys(patch).length > 0) {
      // A stale-cancelled Moka row may now collide with a web reservation.
'''
replacement = '''    // Absolute last guard before touching the exclusion-constrained range.
    // Never send a patch whose resulting end_time is <= start_time.
    if (patch.start_time || patch.end_time) {
      const guardedStart = new Date(patch.start_time || existing.start_time);
      const guardedEnd = new Date(patch.end_time || existing.end_time);
      if (!(guardedEnd > guardedStart)) {
        console.warn(`[Sync] Open bill ${billId} invalid timing patch suppressed: ${guardedStart.toISOString()} → ${guardedEnd.toISOString()}`);
        delete patch.start_time;
        delete patch.end_time;
      }
    }

    if (Object.keys(patch).length > 0) {
      // A stale-cancelled Moka row may now collide with a web reservation.
'''
if needle not in s:
    raise SystemExit('Expected patch write block not found; refusing unsafe patch')
s = s.replace(needle, replacement, 1)

p.write_text(s)
