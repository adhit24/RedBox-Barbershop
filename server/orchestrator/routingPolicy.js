function classifyDeterministically(message) {
  const normalized = String(message || '').toLocaleLowerCase('id-ID');
  if (/\b(admin|manusia|customer service)\b/.test(normalized) || /bicara (dengan )?orang/.test(normalized)) {
    return { intent: 'human_request', confidence: 1 };
  }
  return null;
}

module.exports = { classifyDeterministically };
