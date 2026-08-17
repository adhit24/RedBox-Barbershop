// PostgREST's .or()/.filter() string DSL uses `,` to separate conditions and
// `(`/`)` to nest and()/or() groups. Stripping those characters from a value
// before interpolating it into a filter template prevents a caller-controlled
// value from injecting extra filter clauses.
function escapePostgrestValue(value) {
  return String(value ?? '').replace(/[,()]/g, '');
}

module.exports = { escapePostgrestValue };
