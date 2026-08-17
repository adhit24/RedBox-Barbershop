function escapePostgrestValue(value) {
  return String(value ?? '').replace(/[,()]/g, '');
}

module.exports = { escapePostgrestValue };
