#!/bin/bash

# Get or refresh GCP access token
# Usage: source get_gcp_token.sh
# Sets GCP_ACCESS_TOKEN environment variable with a valid token

TOKEN_FILE="/tmp/gcp_token_cache.json"
CREDS_FILE="/tmp/gcp_creds.json"

# Function to create a new token
create_token() {
    echo "Creating new GCP access token..." >&2

    # Extract credentials from env
    env | grep "export GOOGLE_APPLICATION_CREDENTIALS_JSON" | \
        sed 's/export GOOGLE_APPLICATION_CREDENTIALS_JSON=//' | \
        sed "s/^'//" | sed "s/'$//" > "$CREDS_FILE"

    # Extract private key
    jq -r '.private_key' "$CREDS_FILE" > /tmp/private_key.pem

    # Create JWT
    python3 << 'PYTHON_EOF'
import json
import time
import base64

with open('/tmp/gcp_creds.json', 'r') as f:
    creds = json.load(f)

header = {"alg": "RS256", "typ": "JWT"}
now = int(time.time())
payload = {
    "iss": creds["client_email"],
    "scope": "https://www.googleapis.com/auth/cloud-platform",
    "aud": creds["token_uri"],
    "exp": now + 3600,
    "iat": now
}

def base64url_encode(data):
    if isinstance(data, dict):
        data = json.dumps(data, separators=(',', ':')).encode('utf-8')
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

header_b64 = base64url_encode(header)
payload_b64 = base64url_encode(payload)
signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')

with open('/tmp/signing_input.txt', 'wb') as f:
    f.write(signing_input)
PYTHON_EOF

    # Sign JWT
    openssl dgst -sha256 -sign /tmp/private_key.pem /tmp/signing_input.txt | \
        base64 -w 0 | tr '+/' '-_' | tr -d '=' > /tmp/signature_b64.txt

    # Assemble JWT
    SIGNING_INPUT=$(cat /tmp/signing_input.txt)
    SIGNATURE=$(cat /tmp/signature_b64.txt)
    JWT="$SIGNING_INPUT.$SIGNATURE"

    # Exchange for access token
    curl -s -X POST https://oauth2.googleapis.com/token \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=$JWT" \
        > "$TOKEN_FILE"

    # Add timestamp for expiry checking
    CURRENT_TIME=$(date +%s)
    jq ". + {cached_at: $CURRENT_TIME}" "$TOKEN_FILE" > "${TOKEN_FILE}.tmp"
    mv "${TOKEN_FILE}.tmp" "$TOKEN_FILE"

    echo "✓ New token created" >&2
}

# Check if we have a cached token
if [ -f "$TOKEN_FILE" ]; then
    CACHED_AT=$(jq -r '.cached_at // 0' "$TOKEN_FILE")
    CURRENT_TIME=$(date +%s)
    AGE=$((CURRENT_TIME - CACHED_AT))

    # Refresh if token is older than 55 minutes (3300 seconds)
    # This gives us a 5-minute buffer before the 1-hour expiration
    if [ "$AGE" -lt 3300 ]; then
        echo "Using cached token (age: ${AGE}s, expires in ~$((3600 - AGE))s)" >&2
    else
        echo "Cached token expired (age: ${AGE}s), refreshing..." >&2
        create_token
    fi
else
    create_token
fi

# Export the access token
export GCP_ACCESS_TOKEN=$(jq -r '.access_token' "$TOKEN_FILE")

if [ -z "$GCP_ACCESS_TOKEN" ] || [ "$GCP_ACCESS_TOKEN" = "null" ]; then
    echo "Error: Failed to get access token" >&2
    return 1
fi

echo "✓ GCP_ACCESS_TOKEN is set and ready to use" >&2
