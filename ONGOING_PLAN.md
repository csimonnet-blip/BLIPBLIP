# ONGOING PLAN — TaskFlow (SimoTask)

> **App**: TaskFlow (SimoTask)
> **Platforms**: iPhone, iPad, macOS (App Store)
> **Backend**: Supabase (via Lovable)
> **Automation**: Make.com
> **Version**: v0.1.0 | 2026-02-15

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  iOS/macOS  │────▶│   Supabase   │◀────│  Make.com   │
│    App      │     │  (Lovable)   │     │ Automations │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                     │
                    ┌──────▼───────┐             │
                    │  app_errors  │◀────────────┘
                    │   table      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Edge Funcs   │
                    │ log-error    │
                    │ get-errors   │
                    └──────────────┘
```

## Error Monitoring (Independent from Lovable)

All errors flow into the `app_errors` Supabase table via:
- **Client-side**: App catches errors and POSTs to `log-error` Edge Function
- **Edge Functions**: Self-report errors to the same table
- **Make.com**: Webhook calls `log-error` on automation failures
- **Manual**: Bugs logged in BUGLOG.md

Query errors via:
- `get-errors` Edge Function (REST API)
- `./scripts/check-errors.sh` (CLI)
- Supabase Dashboard (SQL)

---

## Current Phase: Foundation

- [x] Create `app_errors` table migration
- [x] Create `log-error` Edge Function
- [x] Create `get-errors` Edge Function
- [x] Create CLI error check script
- [ ] Deploy migration to Supabase
- [ ] Deploy Edge Functions
- [ ] Wire client-side error handler
- [ ] Set up Make.com error webhook
- [ ] Test end-to-end error flow

## Next Phase: App Features

- [ ] Core task management features
- [ ] App Store submission pipeline
- [ ] Push notifications via Supabase
- [ ] Make.com workflow automations

---

## Deployment Checklist

Every change:
1. Deploy Edge Functions: `supabase functions deploy <name>`
2. Deploy via Lovable to iPhone
3. Publish
4. Check BUGLOG.md + `app_errors` table
