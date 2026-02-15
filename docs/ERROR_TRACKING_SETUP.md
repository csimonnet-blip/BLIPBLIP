# Error Tracking Setup — TaskFlow

## Overview

This system tracks all app errors in a single `app_errors` Supabase table, independent from Lovable. You can query errors via Edge Functions, CLI script, or the Supabase dashboard.

## Step 1: Create the `app_errors` table

Open the Supabase SQL Editor and run:

```sql
-- Copy the contents of supabase/migrations/001_create_app_errors.sql
```

Or use the Supabase CLI:

```bash
supabase db push
```

## Step 2: Deploy Edge Functions

```bash
supabase functions deploy log-error
supabase functions deploy get-errors
```

## Step 3: Log errors from the app

POST to `log-error`:

```javascript
// In your app's error handler
const logError = async (error) => {
  await fetch(`${SUPABASE_URL}/functions/v1/log-error`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      source: 'client',
      severity: 'error',
      message: error.message,
      details: { stack: error.stack, url: window.location.href },
      user_id: currentUser?.id || null,
    }),
  });
};
```

## Step 4: Log errors from Make.com

Create an HTTP module in your Make.com scenario:

- **URL**: `https://<your-project>.supabase.co/functions/v1/log-error`
- **Method**: POST
- **Headers**:
  - `Authorization`: `Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  - `Content-Type`: `application/json`
- **Body**:
```json
{
  "source": "make.com",
  "severity": "error",
  "message": "{{errorMessage}}",
  "details": { "scenario": "{{scenarioName}}", "module": "{{moduleName}}" }
}
```

## Step 5: Query errors

### Via CLI
```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...
./scripts/check-errors.sh
```

### Via API
```bash
curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/functions/v1/get-errors?limit=10&severity=critical&resolved=false"
```

### Via Supabase Dashboard
```sql
SELECT * FROM app_errors
WHERE resolved = false
ORDER BY created_at DESC
LIMIT 50;
```
