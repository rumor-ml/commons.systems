// Specific test for seed 12345 step 7 barrier crossing
// Load the full RealmGenerator from test-realms.js

const fs = require('fs');
const code = fs.readFileSync('./test-realms.js', 'utf8');

// Extract just the class definitions and run them
const globalThis = global;
globalThis.console = console;

// Simple require to load the module
require('./test-realms.js');

console.log('Testing seed 12345 for barrier crossings...\n');

const generator = new RealmGenerator(12345);
generator.initialize(false);

console.log(
  `Initial position: (${generator.currentExplorerPos.q}, ${generator.currentExplorerPos.r})`
);

// Run steps 1-6
for (let i = 1; i <= 6; i++) {
  const before = { ...generator.currentExplorerPos };
  generator.moveExplorer();
  console.log(
    `Step ${i}: (${before.q},${before.r}) -> (${generator.currentExplorerPos.q},${generator.currentExplorerPos.r})`
  );
}

// Step 7 - the critical one
console.log('\n--- STEP 7 (CRITICAL) ---');
const beforeStep7 = { ...generator.currentExplorerPos };
console.log(`Before step 7: (${beforeStep7.q}, ${beforeStep7.r})`);
console.log(`Barrier crossings before: ${generator.barrierCrossings}`);

generator.moveExplorer();

console.log(`After step 7: (${generator.currentExplorerPos.q}, ${generator.currentExplorerPos.r})`);
console.log(`Barrier crossings after: ${generator.barrierCrossings}`);

if (generator.currentExplorerPos.q === -3 && generator.currentExplorerPos.r === 3) {
  console.log('\nExplorer moved to (-3,3) as reported in the bug\!');
}

console.log('\n' + '='.repeat(60));
if (generator.barrierCrossings === 0) {
  console.log('✓ TEST PASSED: No barrier crossings detected');
  console.log('='.repeat(60));
  process.exit(0);
} else {
  console.log('✗ TEST FAILED: Barrier crossing detected\!');
  console.log(`  Expected: 0 barrier crossings`);
  console.log(`  Actual: ${generator.barrierCrossings} barrier crossings`);
  console.log('='.repeat(60));
  process.exit(1);
}
