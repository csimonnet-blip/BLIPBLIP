# BUGLOG — TaskFlow (SimoTask)

> Centralized bug tracking. Check this file + `app_errors` table + Make.com logs.
> Last updated: 2026-02-15

---

## How Errors Are Tracked

| Source | Where to check |
|---|---|
| **App (client-side)** | `app_errors` table (via `get-errors` Edge Function or Supabase dashboard) |
| **Edge Functions** | `app_errors` table + Supabase Function Logs |
| **Make.com** | `app_errors` table (via webhook) + Make.com execution history |
| **Manual reports** | This file (BUGLOG.md) |

### Quick Check Commands

```bash
# View last 20 unresolved errors
./scripts/check-errors.sh

# View last 10 critical errors
./scripts/check-errors.sh 10 critical
```

---

## Open Bugs

| # | Date | Severity | Source | Description | Status |
|---|---|---|---|---|---|
| — | — | — | — | No bugs reported yet | — |

---

## Resolved Bugs

| # | Date | Severity | Source | Description | Resolution |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
