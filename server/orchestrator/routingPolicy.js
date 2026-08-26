function classifyDeterministically(message) {
  const normalized = String(message || '').toLocaleLowerCase('id-ID');
  if (/\b(admin|manusia|customer service)\b/.test(normalized) || /bicara (dengan )?orang/.test(normalized)) {
    return { intent: 'human_request', confidence: 1 };
  }
  if (/\bpoin(ku| saya)?\b|\bcek poin\b|\bpoin saya berapa\b/.test(normalized)) {
    return { intent: 'points_inquiry', confidence: 1 };
  }
  return null;
}

module.exports = { classifyDeterministically };
