#!/usr/bin/env python3
"""
TaskFlow — Make.com Scenario Setup
===================================
Creates the "Travel Email → Voyages" scenario via Make.com API.

Pipeline: Gmail (travel label) → HTTP POST → Supabase Edge Function → Gemini → voyages table
          └─ Router: Success path + Error path (→ log-error)

Usage:
    # With env vars
    MAKE_API_KEY=xxx SUPABASE_SERVICE_ROLE_KEY=xxx python3 scripts/setup-make-scenario.py

    # Or load from .env
    export $(grep -v '^#' .env | grep -v '^$' | xargs) && python3 scripts/setup-make-scenario.py
"""

import json
import os
import subprocess
import sys

# ── Configuration ──────────────────────────────────────────────
MAKE_ZONE = "eu2.make.com"
MAKE_BASE = f"https://{MAKE_ZONE}/api/v2"
TEAM_ID = 1196931
GOOGLE_CONNECTION_ID = 4965194
SUPABASE_EDGE_URL = "https://ysosafbecisjvrxgigat.supabase.co/functions/v1"

# ── Environment ────────────────────────────────────────────────
MAKE_API_KEY = os.environ.get("MAKE_API_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not MAKE_API_KEY:
    print("Error: MAKE_API_KEY is not set.")
    sys.exit(1)

if not SUPABASE_SERVICE_ROLE_KEY:
    print("Warning: SUPABASE_SERVICE_ROLE_KEY not set. Using placeholder in HTTP headers.")
    SUPABASE_AUTH = "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY"
else:
    SUPABASE_AUTH = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"


def api(method, endpoint, data=None):
    """Make an API call to Make.com."""
    cmd = [
        "curl", "-s", "-w", "\n%{http_code}",
        "-X", method,
        f"{MAKE_BASE}{endpoint}",
        "-H", f"Authorization: Token {MAKE_API_KEY}",
        "-H", "Content-Type: application/json",
    ]
    if data:
        cmd += ["-d", json.dumps(data)]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = result.stdout.strip().split("\n")
    http_code = int(lines[-1]) if lines else 0
    body = "\n".join(lines[:-1])
    return http_code, json.loads(body) if body else {}


def build_blueprint():
    """Build the Make.com scenario blueprint."""
    return {
        "name": "TaskFlow — Travel Email \u2192 Voyages",
        "flow": [
            # Module 1: Gmail Watch (Trigger)
            {
                "id": 1,
                "module": "google-email:TriggerNewEmail",
                "version": 1,
                "parameters": {"account": GOOGLE_CONNECTION_ID},
                "mapper": {"maxResults": 10},
                "metadata": {"designer": {"x": 0, "y": 0}},
            },
            # Module 2: HTTP POST → process-travel-email
            {
                "id": 2,
                "module": "http:ActionSendData",
                "version": 3,
                "parameters": {"handleErrors": True},
                "mapper": {
                    "url": f"{SUPABASE_EDGE_URL}/process-travel-email",
                    "serializeUrl": False,
                    "method": "post",
                    "headers": [
                        {"name": "Content-Type", "value": "application/json"},
                        {"name": "Authorization", "value": SUPABASE_AUTH},
                    ],
                    "qs": [],
                    "bodyType": "raw",
                    "parseResponse": True,
                    "authUser": "",
                    "authPass": "",
                    "timeout": 30,
                    "shareCookies": False,
                    "ca": "",
                    "rejectUnauthorized": True,
                    "followRedirect": True,
                    "useQuerystring": False,
                    "followAllRedirects": False,
                    "contentType": "application/json",
                    "body": json.dumps(
                        {
                            "email_subject": "{{1.subject}}",
                            "email_body": "{{1.textPlain}}",
                            "email_from": "{{1.from.address}}",
                            "email_date": "{{1.date}}",
                        }
                    ),
                },
                "metadata": {
                    "designer": {"x": 300, "y": 0},
                    "restore": {
                        "expect": {
                            "method": {"label": "POST"},
                            "bodyType": {"label": "Raw"},
                            "contentType": {"label": "JSON (application/json)"},
                        }
                    },
                },
            },
            # Module 3: Router (success/error paths)
            {
                "id": 3,
                "module": "builtin:BasicRouter",
                "version": 1,
                "parameters": {},
                "mapper": None,
                "metadata": {"designer": {"x": 600, "y": 0}},
                "routes": [
                    # Route 1: Success
                    {
                        "flow": [
                            {
                                "id": 4,
                                "module": "builtin:BasicFeeder",
                                "version": 1,
                                "parameters": {},
                                "filter": {
                                    "name": "Voyage created/updated",
                                    "conditions": [
                                        [
                                            {
                                                "a": "{{2.data.ok}}",
                                                "b": "true",
                                                "o": "text:equal",
                                            }
                                        ]
                                    ],
                                },
                                "mapper": {},
                                "metadata": {"designer": {"x": 900, "y": -150}},
                            }
                        ]
                    },
                    # Route 2: Error → log-error
                    {
                        "flow": [
                            {
                                "id": 5,
                                "module": "http:ActionSendData",
                                "version": 3,
                                "parameters": {"handleErrors": False},
                                "filter": {
                                    "name": "Processing failed",
                                    "conditions": [
                                        [
                                            {
                                                "a": "{{2.data.ok}}",
                                                "b": "true",
                                                "o": "text:notequal",
                                            }
                                        ]
                                    ],
                                },
                                "mapper": {
                                    "url": f"{SUPABASE_EDGE_URL}/log-error",
                                    "serializeUrl": False,
                                    "method": "post",
                                    "headers": [
                                        {
                                            "name": "Content-Type",
                                            "value": "application/json",
                                        },
                                        {
                                            "name": "Authorization",
                                            "value": SUPABASE_AUTH,
                                        },
                                    ],
                                    "qs": [],
                                    "bodyType": "raw",
                                    "parseResponse": False,
                                    "timeout": 10,
                                    "shareCookies": False,
                                    "followRedirect": True,
                                    "followAllRedirects": False,
                                    "contentType": "application/json",
                                    "body": json.dumps(
                                        {
                                            "source": "make.com",
                                            "severity": "error",
                                            "message": "Travel email processing failed",
                                            "details": {
                                                "scenario": "travel-email-automation",
                                                "email_subject": "{{1.subject}}",
                                                "error": "{{2.data.error}}",
                                            },
                                        }
                                    ),
                                },
                                "metadata": {
                                    "designer": {"x": 900, "y": 150},
                                    "restore": {
                                        "expect": {
                                            "method": {"label": "POST"},
                                            "bodyType": {"label": "Raw"},
                                            "contentType": {
                                                "label": "JSON (application/json)"
                                            },
                                        }
                                    },
                                },
                            }
                        ]
                    },
                ],
            },
        ],
        "metadata": {
            "version": 1,
            "scenario": {
                "roundtrips": 1,
                "maxErrors": 3,
                "autoCommit": True,
                "autoCommitTriggerLast": True,
                "sequential": False,
                "confidential": False,
                "dataloss": False,
                "dlq": False,
                "freshVariables": False,
            },
            "designer": {"orphans": []},
            "zone": MAKE_ZONE,
        },
    }


def main():
    # Step 1: Verify connection
    print("Verifying Make.com API connection...")
    code, data = api("GET", "/users/me")
    if code != 200:
        print(f"Authentication failed (HTTP {code})")
        sys.exit(1)
    user = data.get("authUser", {}).get("name", "Unknown")
    print(f"Connected as: {user}")

    # Step 2: Build blueprint
    print("Building scenario blueprint...")
    blueprint = build_blueprint()

    # Step 3: Create scenario
    print("Creating scenario on Make.com...")
    request_body = {
        "blueprint": json.dumps(blueprint),
        "teamId": TEAM_ID,
        "scheduling": json.dumps({"type": "indefinitely", "interval": 900}),
        "confirmed": True,
    }

    code, data = api("POST", "/scenarios?confirmed=true", request_body)

    if code in (200, 201):
        scenario = data["scenario"]
        sid = scenario["id"]
        print(f"\nScenario created successfully!")
        print(f"  ID:       {sid}")
        print(f"  Name:     {scenario['name']}")
        print(f"  URL:      https://{MAKE_ZONE}/scenarios/{sid}")
        print(f"  Schedule: Every 15 minutes")
        print()
        print("Pipeline:")
        print("  1. Gmail Watch (new emails)")
        print("  2. HTTP POST -> process-travel-email (Supabase Edge Function)")
        print("  3. Router:")
        print("     |-- Success: Voyage created/updated")
        print("     |-- Error:   POST -> log-error")
        print()
        print("Next steps:")
        print("  1. Open the scenario URL in Make.com")
        print("  2. Configure the Gmail trigger (select 'travel' label)")
        if not SUPABASE_SERVICE_ROLE_KEY:
            print("  3. Update HTTP Authorization header with your SUPABASE_SERVICE_ROLE_KEY")
        print("  4. Activate the scenario (toggle ON)")
    else:
        print(f"Failed to create scenario (HTTP {code})")
        print(json.dumps(data, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
