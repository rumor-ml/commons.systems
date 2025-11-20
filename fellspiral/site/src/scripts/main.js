// Combat Simulator Data and Logic
const characters = {
  skeleton: {
    name: 'Skeleton',
    type: 'Foe',
    subtype: 'Undead',
    baseAC: 6,
    equipment: [
      { name: 'Scimitar', type: 'weapon', die: 6, slots: 2 },
      { name: 'Chain Mail', type: 'armor', ac: 3, slots: 1 },
      { name: 'Cloak', type: 'armor', ac: 1, slots: 1 }
    ],
    skills: [
      { name: 'All In', type: 'attack', slots: 1 },
      { name: 'Melee', type: 'attack', slots: 1 }
    ]
  },
  skeletonCommander: {
    name: 'Skeleton Commander',
    type: 'Foe',
    subtype: 'Undead',
    baseAC: 6,
    equipment: [
      { name: 'Long Sword', type: 'weapon', die: 10, slots: 2 },
      { name: 'Wood Shield', type: 'armor', ac: 1, slots: 1 },
      { name: 'Helm', type: 'armor', ac: 1, slots: 1 },
      { name: 'Greaves', type: 'armor', ac: 1, slots: 1 },
      { name: 'Cloak', type: 'armor', ac: 1, slots: 1 },
      { name: 'Chain Mail', type: 'armor', ac: 3, slots: 1 }
    ],
    skills: [
      { name: 'Veteran Commander', type: 'core', slots: 1 },
      { name: 'Counter Strike', type: 'defense', slots: 1 },
      { name: 'Surgical', type: 'attack', slots: 1 }
    ]
  },
  ghoul: {
    name: 'Ghoul',
    type: 'Foe',
    subtype: 'Vampire',
    baseAC: 6,
    equipment: [
      { name: 'Claw', type: 'weapon', die: 6, slots: 2 },
      { name: 'Claw 2', type: 'weapon', die: 6, slots: 2 }
    ],
    skills: [
      { name: 'Moving Target', type: 'defense', slots: 1 },
      { name: 'Dual Wielding', type: 'attack', slots: 1 }
    ]
  },
  krovnayaStriga: {
    name: 'Krovnaya Striga',
    type: 'Foe',
    subtype: 'Vampire',
    baseAC: 6,
    equipment: [
      { name: 'Bat', type: 'weapon', die: 12, slots: 2 },
      { name: 'Fangs', type: 'weapon', die: 4, slots: 2 }
    ],
    skills: []
  },
  caleb: {
    name: 'Caleb',
    type: 'Origin',
    subtype: 'Human',
    baseAC: 6,
    equipment: [
      { name: 'Long Sword', type: 'weapon', die: 10, slots: 2 }
    ],
    skills: [
      { name: 'Melee', type: 'attack', slots: 1 },
      { name: 'Surgical', type: 'attack', slots: 1 }
    ]
  }
};

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

// ============================================================================
// AI TACTICAL EVALUATION SYSTEM
// ============================================================================

/**
 * Evaluates the tactical value of an equipment slot
 * Higher scores = more valuable = protect longer
 */
function evaluateEquipmentValue(equipment, combatant) {
  let value = 0;

  if (equipment.type === 'weapon') {
    // Weapon value based on die size and utility
    value += equipment.die * 2; // Base weapon value

    // Bonus for being the only/primary weapon
    const weaponCount = combatant.equipmentSlots.filter(e => e.type === 'weapon').length;
    if (weaponCount === 1) {
      value += 20; // Protect last weapon heavily
    } else if (weaponCount === 2) {
      value += 5; // Dual wielding - both have some value
    }

    // Higher die weapons are more valuable
    if (equipment.die >= 10) value += 10;
    if (equipment.die >= 8) value += 5;

  } else if (equipment.type === 'armor') {
    // Armor value based on AC contribution
    value += (equipment.ac || 0) * 5;

    // High AC armor is very valuable
    if (equipment.ac >= 3) value += 10;

    // Named important armor
    if (equipment.name.includes('Chain Mail')) value += 8;
    if (equipment.name.includes('Shield')) value += 6;
    if (equipment.name.includes('Helm')) value += 3;

    // Cosmetic/low value armor
    if (equipment.name.includes('Cloak')) value -= 5;
  }

  return value;
}

/**
 * Evaluates the tactical value of a skill slot
 * Higher scores = more valuable = protect longer
 */
function evaluateSkillValue(skill, combatant, situation = {}) {
  let value = 15; // Base skill value - skills are generally valuable

  const skillName = skill.name.toLowerCase();

  // Attack skills
  if (skill.type === 'attack') {
    if (skillName.includes('surgical')) value += 10; // Very strong skill
    if (skillName.includes('dual wielding')) {
      const weaponCount = combatant.equipmentSlots.filter(e => e.type === 'weapon').length;
      value += weaponCount >= 2 ? 12 : 2; // Only valuable with 2 weapons
    }
    if (skillName.includes('melee')) value += 8;
    if (skillName.includes('all in')) value += 6; // Risky but powerful
    if (skillName.includes('feint')) value += 9; // Initiative control
  }

  // Defense skills
  if (skill.type === 'defense') {
    if (skillName.includes('counter strike')) value += 12; // Can turn defense into offense
    if (skillName.includes('moving target')) value += 10; // Reliable defense boost
    if (skillName.includes('brace')) value += 7; // Situational but strong
  }

  // Tenacity skills - preserve initiative or equipment
  if (skill.type === 'tenacity') {
    if (skillName.includes('grit')) value += 14; // Initiative preservation is huge
    if (skillName.includes('flesh wound')) value += 11;
  }

  // Core skills
  if (skill.type === 'core') {
    value += 20; // Core abilities are extremely valuable
  }

  return value;
}

/**
 * Determines which slots the defender should sacrifice (after first slot chosen by attacker)
 * Returns array of slots in order they should be lost
 */
function chooseDefenderSlots(combatant, slotsToLose, attackerHasInitiative = false) {
  const allSlots = [
    ...combatant.equipmentSlots.map((eq, idx) => ({
      type: 'equipment',
      index: idx,
      item: eq,
      value: evaluateEquipmentValue(eq, combatant)
    })),
    ...combatant.skillSlots.map((sk, idx) => ({
      type: 'skill',
      index: idx,
      item: sk,
      value: evaluateSkillValue(sk, combatant)
    }))
  ];

  // Sort by value (ascending) - lose least valuable first
  allSlots.sort((a, b) => a.value - b.value);

  const chosenSlots = [];
  let startIndex = 0;

  // If attacker has initiative, they chose first slot already
  if (attackerHasInitiative) {
    startIndex = 1;
  }

  // Choose the least valuable remaining slots
  for (let i = startIndex; i < slotsToLose && i < allSlots.length; i++) {
    chosenSlots.push(allSlots[i]);
  }

  return chosenSlots;
}

/**
 * Decides whether to use a defense skill and which one
 */
function shouldUseDefenseSkill(combatant, attacker, defenseRoll, weaponDie) {
  const defenseSkills = combatant.skillSlots.filter(s => s.type === 'defense');

  if (defenseSkills.length === 0) return null;

  // Calculate expected attack value
  const expectedWeaponRoll = (weaponDie + 1) / 2;
  const expectedTotal = defenseRoll + expectedWeaponRoll;
  const margin = expectedTotal - combatant.currentAC;

  // Counter Strike - use if adjacent and defense might succeed
  const counterStrike = defenseSkills.find(s => s.name === 'Counter Strike');
  if (counterStrike && margin <= 8) {
    // Good chance to defend and gain initiative
    return counterStrike;
  }

  // Moving Target - use if no conditions and we need help
  const movingTarget = defenseSkills.find(s => s.name === 'Moving Target');
  if (movingTarget && !combatant.conditions?.length && margin > 0 && margin < 15) {
    // Defense roll would subtract from total, likely to help
    return movingTarget;
  }

  // Brace - use in desperate situations or when initiative is crucial
  const brace = defenseSkills.find(s => s.name === 'Brace');
  if (brace && margin > 10) {
    // Heavy attack incoming, try to reduce damage and gain initiative
    return brace;
  }

  // Save skills for better opportunities
  return null;
}

/**
 * Decides whether to use a tenacity skill when hit
 */
function shouldUseTenacitySkill(combatant, hasInitiative) {
  const tenacitySkills = combatant.skillSlots.filter(s => s.type === 'tenacity');

  if (tenacitySkills.length === 0) return null;

  // Grit - use if we want to maintain initiative and have other resources
  const grit = tenacitySkills.find(s => s.name === 'Grit');
  if (grit && hasInitiative && combatant.equipmentSlots.length > 2) {
    // Worth sacrificing this skill to keep initiative
    return grit;
  }

  // Flesh Wound - use if we have initiative and want to protect equipment
  const fleshWound = tenacitySkills.find(s => s.name === 'Flesh Wound');
  if (fleshWound && hasInitiative && combatant.equipmentSlots.length > 0) {
    // Creates temporary slot and preserves equipment
    const valuableEquipment = combatant.equipmentSlots.some(e =>
      evaluateEquipmentValue(e, combatant) > 15
    );
    if (valuableEquipment) return fleshWound;
  }

  return null;
}

/**
 * Decides whether to use an attack skill and which one
 */
function shouldUseAttackSkill(combatant, defender, weapon) {
  const attackSkills = combatant.skillSlots.filter(s => s.type === 'attack');

  if (attackSkills.length === 0) return null;

  // Check weapon properties
  const weaponName = weapon.name.toLowerCase();
  const isPrecise = weaponName.includes('sword') || weaponName.includes('dagger') ||
                    weaponName.includes('spear') || weaponName.includes('bow');
  const isSwept = weaponName.includes('scimitar') || weaponName.includes('sword') ||
                  weaponName.includes('axe');
  const isBrutish = weaponName.includes('hammer') || weaponName.includes('axe');

  // Surgical - use with precise weapons (high value)
  const surgical = attackSkills.find(s => s.name === 'Surgical');
  if (surgical && isPrecise) {
    return surgical; // +1 die and +1 to roll is very strong
  }

  // Dual Wielding - use if we have 2 weapons
  const dualWielding = attackSkills.find(s => s.name === 'Dual Wielding');
  const weaponCount = combatant.equipmentSlots.filter(e => e.type === 'weapon').length;
  if (dualWielding && weaponCount >= 2) {
    return dualWielding; // Double attack
  }

  // Melee - use with swept weapons
  const melee = attackSkills.find(s => s.name === 'Melee');
  if (melee && isSwept) {
    return melee; // Can hit adjacent enemies
  }

  // All In - use when opponent is low on resources (risky but high damage)
  const allIn = attackSkills.find(s => s.name === 'All In');
  if (allIn && isBrutish && defender.equipmentSlots.length <= 3) {
    // Opponent is weak, worth the risk
    return allIn;
  }

  // Feint - use when we need initiative or opponent is strong
  const feint = attackSkills.find(s => s.name === 'Feint');
  if (feint && defender.currentAC > combatant.currentAC + 3) {
    // Opponent has better defense, use feint to guarantee hit and gain initiative
    return feint;
  }

  // Save skills for better opportunities
  return null;
}

/**
 * When attacker has initiative, choose which slot to target or condition to impose
 */
function chooseInitiativeAction(attacker, defender) {
  // Evaluate all possible target slots
  const equipmentTargets = defender.equipmentSlots.map((eq, idx) => ({
    type: 'equipment',
    index: idx,
    item: eq,
    value: evaluateEquipmentValue(eq, defender)
  }));

  const skillTargets = defender.skillSlots.map((sk, idx) => ({
    type: 'skill',
    index: idx,
    item: sk,
    value: evaluateSkillValue(sk, defender)
  }));

  // Sort by value (descending) - target most valuable first
  const allTargets = [...equipmentTargets, ...skillTargets].sort((a, b) => b.value - a.value);

  if (allTargets.length === 0) {
    return { action: 'condition', condition: 'stunned' };
  }

  // Decision: Target high-value slot or impose condition?
  const highestValueTarget = allTargets[0];

  // If opponent has very valuable equipment/skills, target them
  if (highestValueTarget.value > 20) {
    return {
      action: 'slot',
      target: highestValueTarget
    };
  }

  // Otherwise, consider conditions based on tactical situation

  // If opponent is already low on resources, finish them
  if (defender.equipmentSlots.length <= 2) {
    return {
      action: 'slot',
      target: highestValueTarget
    };
  }

  // If opponent has multiple resources, consider conditions
  const conditions = ['pinned', 'stunned', 'bleeding'];

  // Pinned is great if we can follow up
  if (attacker.skillSlots.some(s => s.name === 'Pin')) {
    return { action: 'condition', condition: 'pinned' };
  }

  // Bleeding for sustained damage
  if (defender.equipmentSlots.length > 4) {
    return { action: 'condition', condition: 'bleeding' };
  }

  // Default: target valuable slot
  return {
    action: 'slot',
    target: highestValueTarget
  };
}

function runCombatSimulation(char1Key, char2Key) {
  const log = [];
  const round = { value: 0 };

  // Create combatants
  const char1 = characters[char1Key];
  const char2 = characters[char2Key];

  const combatant1 = {
    name: char1.name,
    currentAC: char1.baseAC + char1.equipment.filter(e => e.type === 'armor').reduce((sum, a) => sum + (a.ac || 0), 0),
    equipmentSlots: [...char1.equipment],
    skillSlots: [...char1.skills],
    alive: true,
    hasInitiative: false,
    conditions: []
  };

  const combatant2 = {
    name: char2.name,
    currentAC: char2.baseAC + char2.equipment.filter(e => e.type === 'armor').reduce((sum, a) => sum + (a.ac || 0), 0),
    equipmentSlots: [...char2.equipment],
    skillSlots: [...char2.skills],
    alive: true,
    hasInitiative: false,
    conditions: []
  };

  log.push('⚔️  COMBAT BEGINS  ⚔️\n');
  log.push(`${combatant1.name} (AC ${combatant1.currentAC}) vs ${combatant2.name} (AC ${combatant2.currentAC})\n`);

  // Simulate combat rounds
  while (combatant1.alive && combatant2.alive && round.value < 20) {
    round.value++;
    log.push(`\n═══ ROUND ${round.value} ═══`);

    // Each combatant attacks
    log.push(`\n--- ${combatant1.name}'s Turn ---`);
    simulateAttack(combatant1, combatant2, log);

    if (!combatant2.alive) break;

    log.push(`\n--- ${combatant2.name}'s Turn ---`);
    simulateAttack(combatant2, combatant1, log);

    log.push('\n--- End of Round ---');
  }

  log.push('\n═══════════════════');
  if (combatant1.alive && !combatant2.alive) {
    log.push(`\n🏆 WINNER: ${combatant1.name}!`);
  } else if (!combatant1.alive && combatant2.alive) {
    log.push(`\n🏆 WINNER: ${combatant2.name}!`);
  } else if (!combatant1.alive && !combatant2.alive) {
    log.push('\n⚔️ DRAW - Both defeated!');
  } else {
    log.push('\n⏱️ Combat reached maximum rounds!');
  }

  return log;
}

function simulateAttack(attacker, defender, log) {
  const weapon = attacker.equipmentSlots.find(e => e.type === 'weapon');
  if (!weapon) {
    log.push(`${attacker.name} has no weapon!`);
    return;
  }

  log.push(`\n${attacker.name} attacks with ${weapon.name}`);

  // AI decides whether to use an attack skill
  const attackSkill = shouldUseAttackSkill(attacker, defender, weapon);
  if (attackSkill) {
    log.push(`  🎯 AI Decision: Using ${attackSkill.name} skill`);
  }

  const defenseRoll = rollDie(20);
  const weaponRoll = rollDie(weapon.die);
  const isCrit = weaponRoll === weapon.die;

  // AI decides whether to use a defense skill
  const defenseSkill = shouldUseDefenseSkill(defender, attacker, defenseRoll, weapon.die);
  if (defenseSkill) {
    const defenseSkillRoll = rollDie(20);
    log.push(`  🛡️ AI Decision: ${defender.name} uses ${defenseSkill.name} (rolled ${defenseSkillRoll})`);
  }

  const totalAttack = defenseRoll + weaponRoll;
  const isStrike = totalAttack > defender.currentAC;

  log.push(`  Rolls: Defense ${defenseRoll} + Weapon ${weaponRoll} (d${weapon.die}) = ${totalAttack} vs AC ${defender.currentAC}`);

  if (isStrike) {
    log.push(`  ⚔️ STRIKE! ${isCrit ? '💥 (CRITICAL!)' : ''}`);

    // On crit, attacker gains initiative
    if (isCrit) {
      attacker.hasInitiative = true;
      defender.hasInitiative = false;
      log.push(`  🎭 ${attacker.name} gains INITIATIVE!`);
    } else {
      // By default, defender has initiative
      attacker.hasInitiative = false;
      defender.hasInitiative = true;
    }

    // Apply damage with AI decision-making
    applyDamageWithAI(attacker, defender, log, attackSkill);

  } else {
    log.push(`  🛡️ MISS - Attack didn't exceed AC`);
    // Defender maintains initiative
    defender.hasInitiative = true;
    attacker.hasInitiative = false;
  }
}

/**
 * Applies damage using AI to choose which slots are lost
 */
function applyDamageWithAI(attacker, defender, log, attackSkill) {
  let slotsToLose = 1; // Base damage

  // Check if attack skill adds damage (simplified)
  if (attackSkill?.name === 'All In') {
    slotsToLose += 2;
    log.push(`  💪 All In adds 2 additional slots of damage!`);
  }

  // Check if defender should use tenacity skill
  const tenacitySkill = shouldUseTenacitySkill(defender, defender.hasInitiative);
  if (tenacitySkill) {
    log.push(`  💪 AI Decision: ${defender.name} uses ${tenacitySkill.name} to absorb damage`);

    // Remove the tenacity skill
    const skillIndex = defender.skillSlots.findIndex(s => s.name === tenacitySkill.name);
    if (skillIndex !== -1) {
      defender.skillSlots.splice(skillIndex, 1);
      log.push(`  ⚡ ${defender.name} loses ${tenacitySkill.name} skill but preserves other resources`);
    }

    if (tenacitySkill.name === 'Grit') {
      // Maintain initiative
      log.push(`  🎭 ${defender.name} maintains initiative!`);
    }

    slotsToLose--; // Tenacity skill absorbed one slot
    if (slotsToLose <= 0) return;
  }

  // If attacker has initiative, they choose the first slot
  if (attacker.hasInitiative) {
    const initiativeAction = chooseInitiativeAction(attacker, defender);

    if (initiativeAction.action === 'condition') {
      log.push(`  🎭 AI Decision: ${attacker.name} imposes ${initiativeAction.condition} condition`);
      defender.conditions.push(initiativeAction.condition);
      slotsToLose--;
    } else if (initiativeAction.action === 'slot') {
      const target = initiativeAction.target;
      log.push(`  🎯 AI Decision: ${attacker.name} targets ${target.item.name} (high value)`);

      // Remove the targeted slot
      if (target.type === 'equipment') {
        const removed = defender.equipmentSlots.splice(target.index, 1)[0];
        log.push(`  💥 ${defender.name} loses ${removed.name}`);

        if (removed.type === 'armor') {
          defender.currentAC -= (removed.ac || 0);
          log.push(`  📉 ${defender.name}'s AC reduced to ${defender.currentAC}`);
        }
      } else if (target.type === 'skill') {
        const removed = defender.skillSlots.splice(target.index, 1)[0];
        log.push(`  💥 ${defender.name} loses ${removed.name} skill`);
      }

      slotsToLose--;
    }
  }

  // Defender chooses remaining slots (AI picks least valuable)
  if (slotsToLose > 0) {
    const chosenSlots = chooseDefenderSlots(defender, slotsToLose, attacker.hasInitiative);

    if (chosenSlots.length === 0) {
      // No slots left - shot to the heart!
      log.push(`  💀 ${defender.name} takes SHOT TO THE HEART!`);
      defender.alive = false;
      return;
    }

    log.push(`  🤖 AI Decision: ${defender.name} sacrifices least valuable slots:`);

    // Sort slots by index (descending) to remove from end first (avoids index shift issues)
    const equipmentSlotsToRemove = chosenSlots
      .filter(s => s.type === 'equipment')
      .sort((a, b) => b.index - a.index);

    const skillSlotsToRemove = chosenSlots
      .filter(s => s.type === 'skill')
      .sort((a, b) => b.index - a.index);

    // Remove equipment slots
    for (const slot of equipmentSlotsToRemove) {
      const removed = defender.equipmentSlots.splice(slot.index, 1)[0];
      log.push(`    ↳ ${removed.name} (value: ${slot.value.toFixed(0)})`);

      if (removed.type === 'armor') {
        defender.currentAC -= (removed.ac || 0);
        log.push(`    📉 AC reduced to ${defender.currentAC}`);
      }
    }

    // Remove skill slots
    for (const slot of skillSlotsToRemove) {
      const removed = defender.skillSlots.splice(slot.index, 1)[0];
      log.push(`    ↳ ${removed.name} skill (value: ${slot.value.toFixed(0)})`);
    }
  }

  // Check if defender has any resources left
  if (defender.equipmentSlots.length === 0 && defender.skillSlots.length === 0) {
    log.push(`  💀 ${defender.name} has no resources left - SHOT TO THE HEART!`);
    defender.alive = false;
  }
}

// Tab switching functionality
document.addEventListener('DOMContentLoaded', () => {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;

      // Remove active class from all buttons and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // Add active class to clicked button and corresponding content
      button.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
    });
  });

  // Smooth scroll for navigation links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const href = anchor.getAttribute('href');
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
        // Update URL hash
        history.pushState(null, null, href);
      }
    });
  });

  // Add scroll-based header shadow
  const navbar = document.querySelector('.navbar');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 50) {
      navbar.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    } else {
      navbar.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
    }

    lastScroll = currentScroll;
  });

  // Combat Simulator functionality
  const simulateBtn = document.getElementById('simulateBtn');
  const combatLog = document.getElementById('combatLog');
  const logContent = document.getElementById('logContent');

  if (simulateBtn) {
    simulateBtn.addEventListener('click', () => {
      const char1 = document.getElementById('combatant1').value;
      const char2 = document.getElementById('combatant2').value;

      if (char1 === char2) {
        alert('Please select different combatants!');
        return;
      }

      // Run simulation
      const log = runCombatSimulation(char1, char2);

      // Display log
      logContent.textContent = log.join('\n');
      combatLog.style.display = 'block';

      // Scroll to log
      combatLog.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Add testable functions here if needed
  };
}
