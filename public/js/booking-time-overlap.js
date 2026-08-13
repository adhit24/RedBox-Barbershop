(function exposeBookingTimeOverlap(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RedboxBookingOverlap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBookingTimeOverlap() {
  // startAMin/startBMin: minutes since midnight (e.g. 10:00 -> 600).
  // durAMin/durBMin: duration in minutes.
  // Two half-open ranges [start, start+dur) overlap iff each starts before the other ends.
  function timeRangesOverlap(startAMin, durAMin, startBMin, durBMin) {
    const aEnd = startAMin + durAMin;
    const bEnd = startBMin + durBMin;
    return (startAMin < bEnd) && (startBMin < aEnd);
  }

  return { timeRangesOverlap };
});
