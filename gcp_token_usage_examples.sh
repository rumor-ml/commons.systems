#!/bin/bash

# Examples of using the GCP token caching system

echo "=========================================="
echo "GCP Token Caching Examples"
echo "=========================================="
echo ""

# Example 1: Source the script to set GCP_ACCESS_TOKEN
echo "Example 1: Setting up the token"
echo "$ source get_gcp_token.sh"
source /home/user/commons.systems/get_gcp_token.sh 2>&1
echo ""

# Example 2: Use the token directly
echo "Example 2: Using the token in API calls"
echo "$ curl -H \"Authorization: Bearer \$GCP_ACCESS_TOKEN\" <API_URL>"
echo ""
echo "Testing with tokeninfo API..."
TOKEN_INFO=$(curl -s "https://oauth2.googleapis.com/tokeninfo?access_token=$GCP_ACCESS_TOKEN")
if echo "$TOKEN_INFO" | jq -e '.scope' > /dev/null 2>&1; then
    echo "✓ Token is valid"
    echo "$TOKEN_INFO" | jq '{scope, expires_in}'
else
    echo "Error validating token:"
    echo "$TOKEN_INFO" | jq .
fi
echo ""

# Example 3: Multiple API calls reuse the cached token
echo "Example 3: Second call uses cached token (no regeneration)"
source /home/user/commons.systems/get_gcp_token.sh 2>&1
echo ""

# Example 4: One-liner usage
echo "Example 4: One-liner for scripts"
echo "$ source get_gcp_token.sh 2>/dev/null && curl ..."
echo ""

# Example 5: Check token age
echo "Example 5: Check token cache status"
if [ -f /tmp/gcp_token_cache.json ]; then
    CACHED_AT=$(jq -r '.cached_at' /tmp/gcp_token_cache.json)
    CURRENT_TIME=$(date +%s)
    AGE=$((CURRENT_TIME - CACHED_AT))
    REMAINING=$((3600 - AGE))
    echo "Token age: ${AGE}s"
    echo "Expires in: ${REMAINING}s (~$((REMAINING / 60)) minutes)"
else
    echo "No cached token found"
fi
echo ""

echo "=========================================="
echo "Usage in Your Scripts"
echo "=========================================="
cat << 'USAGE'

# In your bash scripts:
source /home/user/commons.systems/get_gcp_token.sh 2>/dev/null

# Now use $GCP_ACCESS_TOKEN in your curl commands:
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://storage.googleapis.com/storage/v1/b?project=$GCP_PROJECT_ID"

# Or get project info:
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://cloudresourcemanager.googleapis.com/v3/projects/$GCP_PROJECT_ID"

# The token will be automatically refreshed if it's older than 55 minutes

USAGE
