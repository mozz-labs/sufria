#!/usr/bin/env bash
# =============================================================================
# Negative controls for the chain-isolation gate.
#
# A security test that passes is worth nothing until you have watched it fail.
# This script deliberately breaks tenant isolation three ways and asserts that
# chain-isolation.sql catches each one, then restores the database.
#
# Run it in CI alongside the gate itself. If a refactor ever makes the gate pass
# under a broken configuration, this is what tells you.
#
# Usage: DATABASE_URL=postgres://... tests/security/negative-controls.sh
# =============================================================================
set -uo pipefail

DB="${DATABASE_URL:?set DATABASE_URL}"
GATE="$(dirname "$0")/chain-isolation.sql"
fail=0

run_gate() { psql -v ON_ERROR_STOP=1 -q "$DB" -f "$GATE" >/dev/null 2>&1; }

expect_gate_to_fail() {
  local label="$1"
  if run_gate; then
    echo "  ✗ NEGATIVE CONTROL FAILED — gate stayed green with: $label"
    echo "    The gate is not actually testing what it claims to test."
    fail=1
  else
    echo "  ✓ gate correctly went red: $label"
  fi
}

echo "negative controls for tenant isolation"

# ---------------------------------------------------------------------------
# 1. RLS switched off on the orders table.
#    The realistic version of this is a future migration that recreates a table
#    and forgets to re-enable RLS on it.
# ---------------------------------------------------------------------------
psql -q "$DB" -c "ALTER TABLE orders DISABLE ROW LEVEL SECURITY;" >/dev/null
expect_gate_to_fail "RLS disabled on orders"
psql -q "$DB" -c "ALTER TABLE orders ENABLE ROW LEVEL SECURITY;" >/dev/null

# ---------------------------------------------------------------------------
# 2. The application role is a superuser.
#    Superusers bypass RLS unconditionally — FORCE ROW LEVEL SECURITY does not
#    save you. This is the single most common way a correct RLS setup silently
#    stops working: a DATABASE_URL that points at the admin user because that is
#    what the hosting provider handed out.
# ---------------------------------------------------------------------------
psql -q "$DB" -c "ALTER ROLE wafa_dashboard SUPERUSER;" >/dev/null
expect_gate_to_fail "app role granted SUPERUSER"
psql -q "$DB" -c "ALTER ROLE wafa_dashboard NOSUPERUSER;" >/dev/null

# ---------------------------------------------------------------------------
# 3. Session-scoped tenant context instead of transaction-scoped.
#    Checked directly rather than through the gate, because it needs two
#    transactions on one connection.
# ---------------------------------------------------------------------------
leak=$(psql -q -t -A "$DB" <<'SQL'
BEGIN;
  SET ROLE wafa_dashboard;
  SELECT set_config('app.current_restaurant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
  RESET ROLE;
COMMIT;
BEGIN;
  SET ROLE wafa_dashboard;
  SELECT count(*) FROM orders;
  RESET ROLE;
ROLLBACK;
SQL
)
if echo "$leak" | tail -1 | grep -qx "0"; then
  echo "  ✗ NEGATIVE CONTROL FAILED — session-scoped context did not leak."
  echo "    Assertion A4 is therefore vacuous. Investigate before trusting it."
  fail=1
else
  echo "  ✓ session-scoped context leaks as expected (this is why A4 exists)"
fi

# ---------------------------------------------------------------------------
echo ""
if [ "$fail" -eq 0 ]; then
  echo "negative controls passed — the gate detects real breakage"
else
  echo "NEGATIVE CONTROLS FAILED — do not trust the isolation gate"
fi
exit "$fail"
