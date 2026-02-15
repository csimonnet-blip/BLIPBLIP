#!/usr/bin/env bash
# TaskFlow — Quick error check script
# Usage: ./scripts/check-errors.sh [limit] [severity]
#
# Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
# Or pass them inline:
#   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... ./scripts/check-errors.sh

set -euo pipefail

LIMIT="${1:-20}"
SEVERITY="${2:-}"
RESOLVED="false"

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
  echo "  export SUPABASE_URL=https://your-project.supabase.co"
  echo "  export SUPABASE_SERVICE_ROLE_KEY=eyJ..."
  exit 1
fi

PARAMS="limit=${LIMIT}&resolved=${RESOLVED}"
if [ -n "$SEVERITY" ]; then
  PARAMS="${PARAMS}&severity=${SEVERITY}"
fi

URL="${SUPABASE_URL}/functions/v1/get-errors?${PARAMS}"

echo "=== TaskFlow Error Dashboard ==="
echo "Fetching up to ${LIMIT} unresolved errors..."
echo ""

RESPONSE=$(curl -s -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  "$URL")

COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count', '?'))" 2>/dev/null || echo "?")

echo "Found: ${COUNT} error(s)"
echo ""
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
