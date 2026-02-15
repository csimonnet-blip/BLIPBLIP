# Travel Automation Setup — TaskFlow

## Overview

This automation watches your Gmail for emails labeled **"travel"**, extracts travel information using Gemini 3 Pro, and creates/updates voyage records in Supabase automatically.

**Pipeline:** Gmail label → Make.com → Supabase Edge Function → Gemini AI → `voyages` table

---

## Prerequisites

- A Make.com account (free tier works)
- Gmail account connected to Make.com
- A Gmail label called **"travel"** (or "voyage")
- Supabase project with the `voyages` table deployed

---

## Make.com Scenario — Step by Step

### Module 1: Gmail — Watch Emails (Trigger)

1. In Make.com, create a **new scenario**
2. Add the module: **Gmail > Watch Emails**
3. Configure:
   - **Connection**: Connect your Gmail account
   - **Label**: Select **"travel"** (create this label in Gmail first)
   - **Mark as Read**: Yes (optional — avoids reprocessing)
   - **Maximum number of results**: 10
4. Click **OK**
5. Set the **Schedule** to run every **15 minutes** (or as needed)

### Module 2: HTTP — Make a Request

1. Add a second module: **HTTP > Make a Request**
2. Configure:
   - **URL**: `https://ysosafbecisjvrxgigat.supabase.co/functions/v1/process-travel-email`
   - **Method**: `POST`
   - **Headers**:
     | Name | Value |
     |------|-------|
     | `Content-Type` | `application/json` |
     | `Authorization` | `Bearer <SUPABASE_SERVICE_ROLE_KEY>` |
   - **Body type**: `Raw`
   - **Content type**: `JSON (application/json)`
   - **Request content**:
   ```json
   {
     "email_subject": "{{1.subject}}",
     "email_body": "{{1.text}}",
     "email_from": "{{1.from.address}}",
     "email_date": "{{1.date}}"
   }
   ```
3. Click **OK**

### Module 3 (Optional): Router for Error Handling

1. Add a **Router** after Module 2
2. **Route 1 — Success**: Add a **Filter** where `{{2.body.ok}}` equals `true`
   - Optionally add a notification (Slack, email, etc.)
3. **Route 2 — Error**: Add a **Filter** where `{{2.body.ok}}` equals `false`
   - Add an **HTTP > Make a Request** module to log the error:
     - **URL**: `https://ysosafbecisjvrxgigat.supabase.co/functions/v1/log-error`
     - **Method**: `POST`
     - **Headers**: Same as above
     - **Body**:
     ```json
     {
       "source": "make.com",
       "severity": "error",
       "message": "Travel email processing failed",
       "details": {
         "scenario": "travel-email-automation",
         "email_subject": "{{1.subject}}",
         "error": "{{2.body.error}}"
       }
     }
     ```

---

## How It Works

```
1. You receive a flight/hotel/train confirmation email
2. You add the "travel" label in Gmail (or set up a Gmail filter)
3. Make.com detects the new labeled email (every 15 min)
4. Make.com sends the email content to the edge function
5. Gemini 3 Pro extracts: destination, dates, carrier, booking ref, hotel, cost...
6. The function checks if a voyage with the same booking_ref exists:
   - YES → Updates the existing voyage (date change, price update, etc.)
   - NO  → Creates a new voyage record
7. Result is returned to Make.com for logging
```

---

## Gmail Filter (Auto-Label)

To automatically label travel emails, create a Gmail filter:

1. Go to **Gmail > Settings > Filters and Blocked Addresses > Create new filter**
2. Set **From** to:
   ```
   airfrance.fr OR booking.com OR hotels.com OR sncf-connect.com OR ryanair.com OR easyjet.com OR kayak.com OR expedia.com
   ```
3. Click **Create filter** and select:
   - **Apply the label**: `travel`
4. Optionally check **Also apply to matching conversations**

---

## API Reference

### Endpoint

```
POST https://ysosafbecisjvrxgigat.supabase.co/functions/v1/process-travel-email
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email_subject` | string | Yes* | Email subject line |
| `email_body` | string | Yes* | Email body (plain text) |
| `email_from` | string | No | Sender email address |
| `email_date` | string | No | ISO 8601 date when email was received |
| `user_id` | string | No | UUID of the user (for RLS) |

*At least one of `email_subject` or `email_body` is required.

### Response

```json
{
  "ok": true,
  "action": "created",        // or "updated"
  "voyage_id": 1,
  "title": "Vol Paris - Tokyo",
  "destination": "Tokyo Narita",
  "departure_date": "2026-03-15",
  "confidence": 10,
  "notes": "Confirmation de vol aller-retour Paris-Tokyo"
}
```

### Supported Email Types

- Flight confirmations & modifications
- Train reservations (SNCF, Eurostar, etc.)
- Hotel bookings & updates
- Car rental confirmations
- Multi-leg trip confirmations
- Cancellation emails

---

## Voyages Table Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGINT | Auto-incremented ID |
| `title` | TEXT | Trip title (auto-generated) |
| `status` | TEXT | draft / confirmed / in_progress / completed / cancelled |
| `destination` | TEXT | Destination city/airport |
| `origin` | TEXT | Origin city/airport |
| `departure_date` | DATE | Departure date |
| `return_date` | DATE | Return date |
| `transport_type` | TEXT | flight / train / bus / car / ferry / other |
| `carrier` | TEXT | Company name |
| `booking_ref` | TEXT | Booking reference (used for matching updates) |
| `flight_number` | TEXT | Flight number |
| `hotel_name` | TEXT | Hotel name |
| `hotel_checkin` | DATE | Hotel check-in date |
| `hotel_checkout` | DATE | Hotel check-out date |
| `total_cost` | NUMERIC | Total cost |
| `currency` | TEXT | Currency code (EUR, USD, etc.) |
| `extraction_confidence` | SMALLINT | AI confidence score 1-10 |
| `source` | TEXT | email / manual / make.com / api |

---

## Testing

Test manually with curl:

```bash
curl -X POST "https://ysosafbecisjvrxgigat.supabase.co/functions/v1/process-travel-email" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -d '{
    "email_subject": "Your flight booking confirmation",
    "email_body": "Flight AF1234 from Paris to Tokyo on March 15...",
    "email_from": "noreply@airfrance.fr"
  }'
```
