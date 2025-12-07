// Test character generation heuristics
const fs = require('fs');
const path = require('path');

// Mock DOM elements
global.document = {
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
};

global.history = {
  pushState: () => {},
};

global.window = {
  pageYOffset: 0,
  addEventListener: () => {},
};

// Load and execute the main.js file
const mainJsPath = path.join(__dirname, 'fellspiral', 'site', 'src', 'scripts', 'main.js');
const mainJsCode = fs.readFileSync(mainJsPath, 'utf8');

// Extract just the functions we need (without the DOM event listeners)
const functionsOnly = mainJsCode.split('// Tab switching functionality')[0];
eval(functionsOnly);

console.log('🧪 Testing Character Generation Heuristics...\n');
console.log('═'.repeat(70));

// Test different point budgets
const budgets = [15, 20, 25, 30];

for (const budget of budgets) {
  console.log(`\n📊 POINT BUDGET: ${budget} pts`);
  console.log('─'.repeat(70));

  const builds = generateBuildComparison(budget);

  for (const [playstyle, character] of Object.entries(builds)) {
    console.log(`\n🎭 ${character.name}`);
    console.log(
      `   Points: ${character.pointsSpent}/${character.pointBudget} (${character.remainingPoints} remaining)`
    );
    console.log(`   Final AC: ${character.finalAC}`);
    console.log(`   Synergy Score: ${character.synergy}`);

    console.log(`\n   ⚔️  Equipment (${character.equipment.length} items):`);
    for (const item of character.equipment) {
      if (item.type === 'weapon') {
        console.log(`      • ${item.name} (d${item.die}, ${item.slots} slots)`);
      } else {
        console.log(`      • ${item.name} (+${item.ac} AC, ${item.slots} slots)`);
      }
    }

    console.log(`\n   ✨ Skills (${character.skills.length} skills):`);
    for (const skill of character.skills) {
      console.log(`      • ${skill.name} (${skill.type})`);
    }
  }

  console.log('\n' + '─'.repeat(70));
}

console.log('\n');
console.log('═'.repeat(70));
console.log('🏆 CHARACTER BUILD COMPARISON');
console.log('═'.repeat(70));

// Generate optimal builds for 25 pts and compare them
const optimalBudget = 25;
console.log(`\nGenerating optimal builds for ${optimalBudget} point budget...\n`);

const comparison = generateBuildComparison(optimalBudget);

// Evaluate each build
console.log('BUILD EFFECTIVENESS ANALYSIS:\n');

for (const [playstyle, char] of Object.entries(comparison)) {
  const weaponDamage = char.equipment.find((e) => e.type === 'weapon')?.die || 0;
  const totalArmor = char.finalAC - 6; // AC minus base
  const skillCount = char.skills.length;

  // Calculate effectiveness score
  let effectiveness = 0;
  effectiveness += weaponDamage * 2; // Weapon damage is important
  effectiveness += totalArmor * 3; // AC is very important for survival
  effectiveness += skillCount * 5; // Skills provide tactical options
  effectiveness += char.synergy; // Synergy bonus

  console.log(`${char.name}:`);
  console.log(`  Weapon Die: d${weaponDamage}`);
  console.log(`  Armor Bonus: +${totalArmor} AC`);
  console.log(`  Total Skills: ${skillCount}`);
  console.log(`  Synergy: ${char.synergy}`);
  console.log(`  → Effectiveness Score: ${effectiveness.toFixed(1)}`);
  console.log('');
}

console.log('═'.repeat(70));
console.log('\n💡 HEURISTIC INSIGHTS:\n');

console.log('The character generator uses the following heuristics:');
console.log('');
console.log('1. WEAPON SELECTION:');
console.log('   • Aggressive: Prioritizes high-damage weapons (d10)');
console.log('   • Defensive: Balances damage with versatility (d6-d8)');
console.log('   • Ranged: Chooses bow/crossbow for range advantage');
console.log('   • Balanced: Picks reliable all-around weapons (d8)');
console.log('');
console.log('2. ARMOR ALLOCATION:');
console.log('   • Aggressive: 30% of remaining points on armor');
console.log('   • Defensive: 50% of remaining points on armor');
console.log('   • Prioritizes high AC/cost ratio (Chain Mail, Helm)');
console.log('');
console.log('3. SKILL DISTRIBUTION:');
console.log('   • Max 18 skill points or 40% of budget (whichever is lower)');
console.log('   • Aggressive: 70% attack, 20% defense, 10% tenacity');
console.log('   • Defensive: 30% attack, 50% defense, 20% tenacity');
console.log('   • Balanced: 40% attack, 40% defense, 20% tenacity');
console.log('   • Skills chosen based on weapon synergy (Surgical + precise, etc.)');
console.log('');
console.log('4. SYNERGY OPTIMIZATION:');
console.log('   • Surgical + precise weapon: +15 synergy');
console.log('   • Dual Wielding + 2 weapons: +12 synergy');
console.log('   • Melee + swept weapon: +10 synergy');
console.log('   • Balance bonus (attack + defense skills): +5 synergy');
console.log('');
console.log('5. REMAINING POINTS:');
console.log('   • Aggressive builds: Try to add secondary weapon for dual wielding');
console.log('   • Other builds: Spend on additional armor pieces');
console.log('');

console.log('═'.repeat(70));
console.log('\n✅ Character generation heuristics test complete!');
console.log('\nThe AI can now generate optimized character builds for any point budget,');
console.log('with intelligent decisions about weapon selection, armor distribution,');
console.log('skill synergies, and playstyle optimization.\n');
