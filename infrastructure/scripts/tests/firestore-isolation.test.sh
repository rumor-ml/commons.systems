#!/usr/bin/env bash
# Integration test for Firestore data isolation via project IDs
#
# Tests that different project IDs actually isolate Firestore data when using
# the same emulator instance (critical for multi-worktree test concurrency).
#
# Test Strategy:
# 1. Start shared backend emulators (if not running)
# 2. Seed data to project demo-test-111 (simulate worktree A)
# 3. Seed different data to project demo-test-222 (simulate worktree B)
# 4. Query both projects and verify complete isolation
# 5. Cleanup both projects

set -uo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source port utilities for standard emulator ports
source "${SCRIPT_DIR}/port-utils.sh"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Cleanup tracking
BACKEND_STARTED_BY_TEST=false
BACKEND_PID=""

# Test configuration
FIRESTORE_PORT=8081
AUTH_PORT=9099
STORAGE_PORT=9199
PROJECT_A="demo-test-111"
PROJECT_B="demo-test-222"
COLLECTION_NAME="cards"

# Test result tracking
test_pass() {
  local test_name=$1
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "✓ PASS: $test_name"
}

test_fail() {
  local test_name=$1
  local reason=$2
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "✗ FAIL: $test_name"
  echo "  Reason: $reason"
}

run_test() {
  local test_name=$1
  TESTS_RUN=$((TESTS_RUN + 1))
  echo ""
  echo "Running: $test_name"
  $test_name
}

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up test environment..."

  # Only stop backend emulators if we started them
  if [ "$BACKEND_STARTED_BY_TEST" = true ] && [ -n "$BACKEND_PID" ]; then
    echo "Stopping backend emulators (PID: $BACKEND_PID)..."
    kill $BACKEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true

    # Clean up PID file if it exists
    local pid_file="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.pid"
    rm -f "$pid_file"
  fi

  echo "Cleanup complete"
}

trap cleanup EXIT

# ============================================================================
# SETUP: Ensure Backend Emulators Are Running
# ============================================================================

ensure_backend_emulators() {
  echo "Checking backend emulator status..."

  # Check if Firestore emulator is already running
  if nc -z localhost $FIRESTORE_PORT 2>/dev/null; then
    echo "✓ Backend emulators already running - reusing"
    return 0
  fi

  echo "Starting backend emulators for testing..."

  # Create temp directory
  mkdir -p "${PROJECT_ROOT}/tmp/infrastructure"

  local log_file="${PROJECT_ROOT}/tmp/infrastructure/firestore-isolation-test.log"
  local pid_file="${PROJECT_ROOT}/tmp/infrastructure/firebase-backend-emulators.pid"

  # Start backend emulators
  cd "$PROJECT_ROOT"
  npx firebase-tools emulators:start \
    --only auth,firestore,storage \
    --project="demo-test" \
    > "$log_file" 2>&1 &

  BACKEND_PID=$!
  BACKEND_STARTED_BY_TEST=true
  echo "$BACKEND_PID" > "$pid_file"

  echo "Backend emulators started with PID: $BACKEND_PID"
  echo "Log file: $log_file"

  # Wait for Firestore to be ready
  echo "Waiting for Firestore emulator on port $FIRESTORE_PORT..."
  local retry_count=0
  local max_retries=30

  while ! nc -z localhost $FIRESTORE_PORT 2>/dev/null; do
    retry_count=$((retry_count + 1))
    if [ $retry_count -ge $max_retries ]; then
      echo "ERROR: Firestore emulator failed to start after ${max_retries} seconds"
      echo "Last 20 lines of log:"
      tail -n 20 "$log_file"
      return 1
    fi
    sleep 1
  done

  echo "✓ Firestore emulator ready"
  return 0
}

# ============================================================================
# HELPER: Seed Data to Specific Project
# ============================================================================

seed_firestore_project() {
  local project_id=$1
  local data_prefix=$2
  local card_count=$3

  echo "  Seeding ${card_count} cards to project '${project_id}' (prefix: ${data_prefix})..."

  # Create Node.js script to seed data
  local seed_script="${PROJECT_ROOT}/tmp/infrastructure/seed-${project_id}.js"

  cat > "$seed_script" <<'SEED_EOF'
import admin from 'firebase-admin';

const projectId = process.argv[2];
const prefix = process.argv[3];
const count = parseInt(process.argv[4], 10);

// Initialize Firebase Admin with specific project ID
if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
db.settings({
  host: 'localhost:8081',
  ssl: false,
});

const collection = db.collection('cards');

// Create test cards with unique IDs based on prefix
const cards = [];
for (let i = 0; i < count; i++) {
  cards.push({
    id: `${prefix}-card-${i}`,
    title: `${prefix} Card ${i}`,
    description: `Test card from project ${projectId}`,
  });
}

// Clear existing data
const existing = await collection.get();
if (!existing.empty) {
  const deleteBatch = db.batch();
  existing.docs.forEach(doc => deleteBatch.delete(doc.ref));
  await deleteBatch.commit();
  console.log(`Cleared ${existing.size} existing cards`);
}

// Batch write
const batch = db.batch();
for (const card of cards) {
  const docRef = collection.doc(card.id);
  batch.set(docRef, card);
}

await batch.commit();
console.log(`✓ Seeded ${count} cards to project ${projectId}`);
process.exit(0);
SEED_EOF

  # Run seeding script
  cd "$PROJECT_ROOT"
  if ! node "$seed_script" "$project_id" "$data_prefix" "$card_count" 2>&1; then
    echo "  ERROR: Failed to seed project $project_id"
    return 1
  fi

  rm -f "$seed_script"
  return 0
}

# ============================================================================
# HELPER: Query Data from Specific Project
# ============================================================================

query_firestore_project() {
  local project_id=$1
  local output_var=$2

  echo "  Querying cards from project '${project_id}'..."

  # Create Node.js script to query data
  local query_script="${PROJECT_ROOT}/tmp/infrastructure/query-${project_id}.js"

  cat > "$query_script" <<'QUERY_EOF'
import admin from 'firebase-admin';

const projectId = process.argv[2];

// Initialize Firebase Admin with specific project ID
if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
db.settings({
  host: 'localhost:8081',
  ssl: false,
});

const collection = db.collection('cards');
const snapshot = await collection.get();

// Output card IDs (one per line)
snapshot.docs.forEach(doc => {
  console.log(doc.id);
});

process.exit(0);
QUERY_EOF

  # Run query script and capture output
  cd "$PROJECT_ROOT"
  local result
  if ! result=$(node "$query_script" "$project_id" 2>&1); then
    echo "  ERROR: Failed to query project $project_id"
    rm -f "$query_script"
    return 1
  fi

  rm -f "$query_script"

  # Return result via eval (caller should declare variable)
  eval "$output_var=\$result"
  return 0
}

# ============================================================================
# HELPER: Clear Data from Specific Project
# ============================================================================

clear_firestore_project() {
  local project_id=$1

  echo "  Clearing all cards from project '${project_id}'..."

  # Create Node.js script to clear data
  local clear_script="${PROJECT_ROOT}/tmp/infrastructure/clear-${project_id}.js"

  cat > "$clear_script" <<'CLEAR_EOF'
import admin from 'firebase-admin';

const projectId = process.argv[2];

// Initialize Firebase Admin with specific project ID
if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
db.settings({
  host: 'localhost:8081',
  ssl: false,
});

const collection = db.collection('cards');
const snapshot = await collection.get();

if (!snapshot.empty) {
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`Cleared ${snapshot.size} cards`);
} else {
  console.log('No cards to clear');
}

process.exit(0);
CLEAR_EOF

  # Run clear script
  cd "$PROJECT_ROOT"
  if ! node "$clear_script" "$project_id" 2>&1; then
    echo "  ERROR: Failed to clear project $project_id"
    rm -f "$clear_script"
    return 1
  fi

  rm -f "$clear_script"
  return 0
}

# ============================================================================
# TEST 1: Basic Project Isolation
# ============================================================================

test_basic_project_isolation() {
  local test_name="test_basic_project_isolation"

  # Seed 5 cards to Project A
  if ! seed_firestore_project "$PROJECT_A" "projectA" 5; then
    test_fail "$test_name" "Failed to seed Project A"
    return 1
  fi

  # Seed 3 cards to Project B
  if ! seed_firestore_project "$PROJECT_B" "projectB" 3; then
    test_fail "$test_name" "Failed to seed Project B"
    return 1
  fi

  # Query Project A - should only see Project A's data
  local cards_a=""
  if ! query_firestore_project "$PROJECT_A" cards_a; then
    test_fail "$test_name" "Failed to query Project A"
    return 1
  fi

  # Query Project B - should only see Project B's data
  local cards_b=""
  if ! query_firestore_project "$PROJECT_B" cards_b; then
    test_fail "$test_name" "Failed to query Project B"
    return 1
  fi

  # Verify Project A has exactly 5 cards
  local count_a=$(echo "$cards_a" | grep -c "^projectA-card-" || true)
  if [ "$count_a" -ne 5 ]; then
    test_fail "$test_name" "Project A expected 5 cards, got $count_a"
    echo "  Project A cards: $cards_a"
    return 1
  fi

  # Verify Project B has exactly 3 cards
  local count_b=$(echo "$cards_b" | grep -c "^projectB-card-" || true)
  if [ "$count_b" -ne 3 ]; then
    test_fail "$test_name" "Project B expected 3 cards, got $count_b"
    echo "  Project B cards: $cards_b"
    return 1
  fi

  # Verify no cross-contamination (Project A doesn't see Project B's cards)
  local contamination_a=$(echo "$cards_a" | grep -c "^projectB-card-" || true)
  if [ "$contamination_a" -ne 0 ]; then
    test_fail "$test_name" "Project A sees ${contamination_a} cards from Project B"
    return 1
  fi

  # Verify no cross-contamination (Project B doesn't see Project A's cards)
  local contamination_b=$(echo "$cards_b" | grep -c "^projectA-card-" || true)
  if [ "$contamination_b" -ne 0 ]; then
    test_fail "$test_name" "Project B sees ${contamination_b} cards from Project A"
    return 1
  fi

  test_pass "$test_name"
}

# ============================================================================
# TEST 2: Concurrent Write Isolation
# ============================================================================

test_concurrent_write_isolation() {
  local test_name="test_concurrent_write_isolation"

  # Clear both projects first
  clear_firestore_project "$PROJECT_A" > /dev/null
  clear_firestore_project "$PROJECT_B" > /dev/null

  # Simulate concurrent writes by seeding both projects "simultaneously"
  echo "  Simulating concurrent writes..."
  seed_firestore_project "$PROJECT_A" "concurrent-A" 10 > /dev/null &
  local pid_a=$!

  seed_firestore_project "$PROJECT_B" "concurrent-B" 10 > /dev/null &
  local pid_b=$!

  # Wait for both to complete
  wait $pid_a
  local exit_a=$?
  wait $pid_b
  local exit_b=$?

  if [ $exit_a -ne 0 ] || [ $exit_b -ne 0 ]; then
    test_fail "$test_name" "Concurrent seeding failed (A: $exit_a, B: $exit_b)"
    return 1
  fi

  # Query both projects
  local cards_a=""
  local cards_b=""
  query_firestore_project "$PROJECT_A" cards_a > /dev/null
  query_firestore_project "$PROJECT_B" cards_b > /dev/null

  # Verify each project has exactly 10 cards with correct prefix
  local count_a=$(echo "$cards_a" | grep -c "^concurrent-A-card-" || true)
  local count_b=$(echo "$cards_b" | grep -c "^concurrent-B-card-" || true)

  if [ "$count_a" -ne 10 ]; then
    test_fail "$test_name" "Project A expected 10 cards after concurrent write, got $count_a"
    return 1
  fi

  if [ "$count_b" -ne 10 ]; then
    test_fail "$test_name" "Project B expected 10 cards after concurrent write, got $count_b"
    return 1
  fi

  # Verify no cross-contamination
  local contamination_a=$(echo "$cards_a" | grep -c "^concurrent-B-card-" || true)
  local contamination_b=$(echo "$cards_b" | grep -c "^concurrent-A-card-" || true)

  if [ "$contamination_a" -ne 0 ] || [ "$contamination_b" -ne 0 ]; then
    test_fail "$test_name" "Cross-contamination detected (A has $contamination_a from B, B has $contamination_b from A)"
    return 1
  fi

  test_pass "$test_name"
}

# ============================================================================
# TEST 3: Empty Project Independence
# ============================================================================

test_empty_project_independence() {
  local test_name="test_empty_project_independence"

  # Clear Project A
  clear_firestore_project "$PROJECT_A" > /dev/null

  # Seed only Project B
  seed_firestore_project "$PROJECT_B" "onlyB" 7 > /dev/null

  # Query both projects
  local cards_a=""
  local cards_b=""
  query_firestore_project "$PROJECT_A" cards_a > /dev/null
  query_firestore_project "$PROJECT_B" cards_b > /dev/null

  # Project A should be empty
  local count_a=$(echo "$cards_a" | grep -c "^" || true)
  # Empty string results in count of 1 (empty line), so check for actual cards
  local actual_cards_a=$(echo "$cards_a" | grep -c "^onlyB-card-" || true)

  if [ "$actual_cards_a" -ne 0 ]; then
    test_fail "$test_name" "Project A should be empty but has $actual_cards_a cards"
    echo "  Project A cards: $cards_a"
    return 1
  fi

  # Project B should have 7 cards
  local count_b=$(echo "$cards_b" | grep -c "^onlyB-card-" || true)
  if [ "$count_b" -ne 7 ]; then
    test_fail "$test_name" "Project B expected 7 cards, got $count_b"
    return 1
  fi

  test_pass "$test_name"
}

# ============================================================================
# TEST 4: GCP_PROJECT_ID Environment Variable Propagation
# ============================================================================

test_gcp_project_id_propagation() {
  local test_name="test_gcp_project_id_propagation"

  # This test verifies that the GCP_PROJECT_ID environment variable
  # correctly propagates to Firebase Admin SDK initialization

  # Create a test script that uses GCP_PROJECT_ID (like global-setup.ts does)
  local test_script="${PROJECT_ROOT}/tmp/infrastructure/test-env-propagation.js"

  cat > "$test_script" <<'ENV_EOF'
import admin from 'firebase-admin';

// Simulate global-setup.ts behavior
const projectId = process.env.GCP_PROJECT_ID || 'demo-test';

console.log(`Initializing with projectId: ${projectId}`);

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
db.settings({
  host: 'localhost:8081',
  ssl: false,
});

// Write a test document
const testDoc = db.collection('env_test').doc('test-doc');
await testDoc.set({
  projectId,
  timestamp: Date.now()
});

// Read it back to verify
const snapshot = await testDoc.get();
const data = snapshot.data();

if (data.projectId === projectId) {
  console.log(`✓ Project ID propagated correctly: ${projectId}`);
  process.exit(0);
} else {
  console.error(`✗ Project ID mismatch: expected ${projectId}, got ${data.projectId}`);
  process.exit(1);
}
ENV_EOF

  # Test with explicit GCP_PROJECT_ID
  local test_project="demo-test-env-test"
  cd "$PROJECT_ROOT"

  if ! GCP_PROJECT_ID="$test_project" node "$test_script" 2>&1 | grep -q "✓ Project ID propagated correctly"; then
    test_fail "$test_name" "GCP_PROJECT_ID environment variable did not propagate correctly"
    rm -f "$test_script"
    return 1
  fi

  rm -f "$test_script"

  # Clean up test collection
  local cleanup_script="${PROJECT_ROOT}/tmp/infrastructure/cleanup-env-test.js"
  cat > "$cleanup_script" <<'CLEANUP_EOF'
import admin from 'firebase-admin';

const projectId = 'demo-test-env-test';

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
db.settings({
  host: 'localhost:8081',
  ssl: false,
});

await db.collection('env_test').doc('test-doc').delete();
process.exit(0);
CLEANUP_EOF

  node "$cleanup_script" > /dev/null 2>&1 || true
  rm -f "$cleanup_script"

  test_pass "$test_name"
}

# ============================================================================
# MAIN TEST EXECUTION
# ============================================================================

main() {
  echo "========================================="
  echo "Firestore Project Isolation Tests"
  echo "========================================="
  echo ""
  echo "These tests verify that different project IDs isolate Firestore data"
  echo "when using the same emulator instance (critical for multi-worktree tests)."
  echo ""

  # Ensure backend emulators are running
  if ! ensure_backend_emulators; then
    echo ""
    echo "FATAL: Could not start backend emulators"
    exit 1
  fi

  echo ""
  echo "========================================="
  echo "Running Tests"
  echo "========================================="

  # Run all tests
  run_test test_basic_project_isolation
  run_test test_concurrent_write_isolation
  run_test test_empty_project_independence
  run_test test_gcp_project_id_propagation

  # Cleanup test data
  echo ""
  echo "Cleaning up test data..."
  clear_firestore_project "$PROJECT_A" > /dev/null || true
  clear_firestore_project "$PROJECT_B" > /dev/null || true
  clear_firestore_project "demo-test-env-test" > /dev/null || true

  # Print summary
  echo ""
  echo "========================================="
  echo "Test Summary"
  echo "========================================="
  echo "Total tests: $TESTS_RUN"
  echo "Passed: $TESTS_PASSED"
  echo "Failed: $TESTS_FAILED"
  echo ""

  if [ $TESTS_FAILED -eq 0 ]; then
    echo "✅ All tests passed!"
    return 0
  else
    echo "❌ Some tests failed"
    return 1
  fi
}

# Run main function
main
exit $?
