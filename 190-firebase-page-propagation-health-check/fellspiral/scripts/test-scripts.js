#!/usr/bin/env node
/**
 * Test suite for parse-cards.js
 */

import { parseCards } from './parse-cards.js';

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    failedTests++;
    console.error(`❌ ${name}`);
    console.error(`   ${error.message}`);
    return false;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\n🧪 Running parse-cards.js tests...\n');

// Test 1: Parse a simple markdown table correctly
test('Parse simple markdown table', () => {
  const markdown = `
# Equipment

# Weapons

| title | description | cost |
|-------|-------------|------|
| Sword | A sharp blade | 10 |
`;

  const { cards } = parseCards(markdown);
  assertEquals(cards.length, 1, 'Should parse 1 card');
  assertEquals(cards[0].title, 'Sword', 'Should extract title');
  assertEquals(cards[0].description, 'A sharp blade', 'Should extract description');
  assertEquals(cards[0].cost, '10', 'Should extract cost');
  assertEquals(cards[0].type, 'Equipment', 'Should infer type from header');
  assertEquals(cards[0].subtype, 'Weapon', 'Should infer subtype from header (normalized)');
});

// Test 2: Generate correct IDs (lowercase, spaces to hyphens)
test('Generate correct IDs', () => {
  const markdown = `
# Equipment

# Weapons

| title | description |
|-------|-------------|
| Iron Sword | A basic sword |
| Magic Staff! | A magical staff |
`;

  const { cards } = parseCards(markdown);
  assertEquals(cards[0].id, 'iron-sword', 'Should convert to lowercase with hyphens');
  assertEquals(cards[1].id, 'magic-staff', 'Should strip special characters');
});

// Test 3: Skip true duplicates (same card data)
test('Skip true duplicates', () => {
  const markdown = `
# Equipment

# Weapons

| title | description |
|-------|-------------|
| Sword | A sharp blade |
| Dagger | A small knife |

# Weapons

| title | description |
|-------|-------------|
| Sword | A sharp blade |
`;

  const { cards, duplicatesSkipped } = parseCards(markdown);
  assertEquals(duplicatesSkipped, 1, 'Should skip 1 duplicate');
  assertEquals(cards.length, 2, 'Should have 2 unique cards');
  assertEquals(cards[0].title, 'Sword', 'Should keep first Sword');
  assertEquals(cards[1].title, 'Dagger', 'Should keep Dagger');
});

// Test 4: Add suffix for ID collisions (different cards, same title)
test('Add suffix for ID collisions', () => {
  const markdown = `
# Equipment

# Weapons

| title | description |
|-------|-------------|
| Armor | A weapon named Armor |

# Armor

| title | description |
|-------|-------------|
| Armor | Protective gear |
`;

  const { cards } = parseCards(markdown);
  assertEquals(cards.length, 2, 'Should have 2 cards');
  assertEquals(cards[0].id, 'armor', 'First card should have base ID');
  assertEquals(cards[1].id, 'armor-1', 'Second card should have suffix');
  assertEquals(cards[0].description, 'A weapon named Armor', 'First card should be the weapon');
  assertEquals(cards[1].description, 'Protective gear', 'Second card should be the armor');
});

// Test 5: Skip cards missing required fields
test('Skip cards missing required fields', () => {
  const markdown = `
| title | description |
|-------|-------------|
| No Type Card | Missing type and subtype |
`;

  const { cards, validationSkipped } = parseCards(markdown);
  assertEquals(validationSkipped, 1, 'Should skip 1 card for missing type');
  assertEquals(cards.length, 0, 'Should have 0 cards');
});

// Test 6: Handle subtype normalization (plural to singular)
test('Normalize plural subtypes to singular', () => {
  const markdown = `
# Equipment

# Weapons

| title | description |
|-------|-------------|
| Sword | A sharp blade |
`;

  const { cards } = parseCards(markdown);
  assertEquals(cards[0].subtype, 'Weapon', 'Should normalize "Weapons" to "Weapon"');
});

// Test 7: Parse cards with tags
test('Parse cards with tags', () => {
  const markdown = `
# Equipment

# Weapons

| title | description | tags |
|-------|-------------|------|
| Sword | A sharp blade | - sharp<br>- metal |
`;

  const { cards } = parseCards(markdown);
  assertTrue(Array.isArray(cards[0].tags), 'Tags should be an array');
  assertArrayEquals(cards[0].tags, ['sharp', 'metal'], 'Should parse tags correctly');
});

// Test 8: Handle cards with type and subtype columns
test('Parse cards with type and subtype columns', () => {
  const markdown = `
| title | type | subtype | description |
|-------|------|---------|-------------|
| Sword | Equipment | Weapon | A sharp blade |
`;

  const { cards } = parseCards(markdown);
  assertEquals(cards[0].type, 'Equipment', 'Should use type from column');
  assertEquals(cards[0].subtype, 'Weapon', 'Should use subtype from column');
});

// Test 9: Add timestamps to cards
test('Add timestamps to cards', () => {
  const markdown = `
# Equipment

# Weapons

| title | description |
|-------|-------------|
| Sword | A sharp blade |
`;

  const { cards } = parseCards(markdown);
  assertTrue(cards[0].createdAt !== undefined, 'Should have createdAt timestamp');
  assertTrue(cards[0].updatedAt !== undefined, 'Should have updatedAt timestamp');
  assertTrue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(cards[0].createdAt), 'createdAt should be ISO format');
});

// Test 10: Handle empty tables
test('Handle empty input', () => {
  const markdown = `
# Equipment

# Weapons
`;

  const { cards, duplicatesSkipped, validationSkipped } = parseCards(markdown);
  assertEquals(cards.length, 0, 'Should have 0 cards');
  assertEquals(duplicatesSkipped, 0, 'Should have 0 duplicates');
  assertEquals(validationSkipped, 0, 'Should have 0 validation failures');
});

// Print summary
console.log('\n' + '='.repeat(50));
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log('='.repeat(50) + '\n');

if (failedTests > 0) {
  console.error(`❌ ${failedTests} test(s) failed\n`);
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
  process.exit(0);
}
