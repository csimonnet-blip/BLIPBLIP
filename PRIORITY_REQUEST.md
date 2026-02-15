# PRIORITY REQUEST — TaskFlow (SimoTask)

> **Status**: v0.1.0 | Last updated: 2026-02-15
> **Workflow**: PRIORITY REQUEST > ON-GOING > ACHIEVED > VALIDATED

---

## PRIORITY REQUEST

1. **Deploy `app_errors` table to Supabase**
   - Run migration `supabase/migrations/001_create_app_errors.sql` in Supabase SQL Editor
   - This creates the centralized error tracking table

2. **Deploy Edge Functions**
   - `supabase functions deploy log-error`
   - `supabase functions deploy get-errors`
   - These allow logging and querying errors without going through Lovable

3. **Wire client-side error reporting**
   - Add error handler in the app that POSTs to `/functions/v1/log-error`
   - Example payload: `{ "source": "client", "severity": "error", "message": "...", "details": {...} }`

4. **Set up Make.com error webhook**
   - Create a Make.com scenario that calls `/functions/v1/log-error` when automation errors occur
   - Source: `"make.com"`

---

## ON-GOING

- [ ] Error monitoring system setup (app_errors table + Edge Functions)
- [ ] Make.com webhook integration for error reporting
- [ ] Client-side error handler integration in app

---

## ACHIEVED

_(Nothing yet — move items here once completed)_

---

## VALIDATED

_(Nothing yet — move items here once tested in production)_
