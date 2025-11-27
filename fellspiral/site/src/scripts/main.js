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

// ============================================================================
// CHARACTER GENERATION HEURISTICS
// ============================================================================

/**
 * Equipment and skill database with costs and properties
 */
const EQUIPMENT_DATABASE = {
  weapons: [
    { name: 'Long Sword', die: 10, slots: 2, cost: 5, tags: ['2h', 'swept', 'precise'], special: 'Can use 1h (d8, lose -1c)' },
    { name: 'Short Sword', die: 8, slots: 2, cost: 5, tags: ['precise'] },
    { name: 'Scimitar', die: 6, slots: 2, cost: 5, tags: ['swept', 'precise', '1 adjacent'] },
    { name: 'Dagger', die: 4, slots: 2, cost: 5, tags: ['0-1 thrown', 'precise'] },
    { name: 'Spear', die: 8, slots: 2, cost: 5, tags: ['0-1 thrown', 'reach', 'precise'] },
    { name: 'Long Bow', die: 6, slots: 2, cost: 5, tags: ['1-4 ranged', 'precise', '2h', '1x'] },
    { name: 'Short Bow', die: 6, slots: 2, cost: 5, tags: ['0-2 ranged', 'precise', '2h'] },
    { name: 'Crossbow', die: 8, slots: 2, cost: 5, tags: ['1-2 ranged', 'precise', '2h'] },
    { name: 'War Hammer', die: 8, slots: 2, cost: 5, tags: ['2h', 'brutish', 'swept'], special: 'On crit: stun 1 round' },
    { name: 'Great Axe', die: 8, slots: 2, cost: 5, tags: ['2h', 'swept', 'brutish', '2 adjacent'] },
    { name: 'Studded Mace', die: 6, slots: 2, cost: 5, tags: [], special: 'On crit: stun 3 phases' },
    { name: 'Walking Staff', die: 6, slots: 1, cost: 5, tags: ['2h', 'swept'], special: 'On crit: pin 1 round' }
  ],
  armor: [
    { name: 'Chain Mail', ac: 3, slots: 1, cost: 3 },
    { name: 'Scale Vest', ac: 3, slots: 1, cost: 5, tags: ['durable'] },
    { name: 'Wood Shield', ac: 1, slots: 1, cost: 3, tags: ['durable'] },
    { name: 'Helm', ac: 1, slots: 1, cost: 1 },
    { name: 'Greaves', ac: 1, slots: 1, cost: 2 },
    { name: 'Cloak', ac: 1, slots: 1, cost: 1 }
  ]
};

const SKILLS_DATABASE = {
  attack: [
    { name: 'Surgical', slots: 1, cost: 1, requires: 'precise weapon + adjacent', effect: '+1 die, +1 roll' },
    { name: 'Dual Wielding', slots: 1, cost: 1, requires: '2 weapons', effect: 'Second attack with other weapon' },
    { name: 'Melee', slots: 1, cost: 1, requires: 'swept weapon', effect: 'Add 1 adjacent on strike' },
    { name: 'All In', slots: 1, cost: 1, requires: 'brutish weapon + adjacent', effect: '+2 slots damage, -5 AC' },
    { name: 'Feint', slots: 1, cost: 1, requires: 'any', effect: 'Auto-succeed, stun 1 round, gain initiative' },
    { name: 'Take Aim', slots: 1, cost: 1, requires: 'ranged + precise', effect: 'Delay 1d6 phases, +1 die +3 roll' }
  ],
  defense: [
    { name: 'Counter Strike', slots: 1, cost: 1, requires: 'attacker adjacent', effect: 'On defense+skill success: no damage, gain initiative' },
    { name: 'Moving Target', slots: 1, cost: 1, requires: 'no conditions', effect: 'Subtract skill roll from defense (min 0)' },
    { name: 'Brace', slots: 1, cost: 1, requires: 'skip next action', effect: 'Subtract from defense, always have initiative' }
  ],
  tenacity: [
    { name: 'Grit', slots: 1, cost: 1, requires: 'when hit', effect: '1 slot to this skill, maintain initiative' },
    { name: 'Flesh Wound', slots: 1, cost: 1, requires: 'have initiative', effect: '1 slot here, gain temporary meat shield slot' }
  ]
};

/**
 * Evaluates the synergy between equipment and skills
 */
function evaluateSynergy(equipment, skills) {
  let synergy = 0;

  const weapons = equipment.filter(e => e.type === 'weapon');
  const hasWeapon = weapons.length > 0;

  if (!hasWeapon) return 0;

  const primaryWeapon = weapons[0];
  const isPrecise = primaryWeapon.tags?.includes('precise') || primaryWeapon.name.includes('Sword') || primaryWeapon.name.includes('Bow');
  const isSwept = primaryWeapon.tags?.includes('swept') || primaryWeapon.name.includes('Scimitar') || primaryWeapon.name.includes('Sword');
  const isBrutish = primaryWeapon.tags?.includes('brutish') || primaryWeapon.name.includes('Hammer') || primaryWeapon.name.includes('Axe');
  const isRanged = primaryWeapon.tags?.some(t => t.includes('ranged'));

  for (const skill of skills) {
    const skillName = skill.name.toLowerCase();

    // Surgical synergy with precise weapons
    if (skillName.includes('surgical') && isPrecise) synergy += 15;

    // Dual Wielding synergy
    if (skillName.includes('dual wielding') && weapons.length >= 2) synergy += 12;

    // Melee synergy with swept weapons
    if (skillName.includes('melee') && isSwept) synergy += 10;

    // All In synergy with brutish weapons
    if (skillName.includes('all in') && isBrutish) synergy += 8;

    // Take Aim synergy with ranged precise weapons
    if (skillName.includes('take aim') && isRanged && isPrecise) synergy += 10;
  }

  // Bonus for having balance
  const attackSkills = skills.filter(s => s.type === 'attack').length;
  const defenseSkills = skills.filter(s => s.type === 'defense').length;
  const tenacitySkills = skills.filter(s => s.type === 'tenacity').length;

  if (attackSkills > 0 && defenseSkills > 0) synergy += 5; // Balance bonus
  if (tenacitySkills > 0) synergy += 3; // Tenacity is always valuable

  return synergy;
}

/**
 * Generates a character build for a given point budget
 * @param {number} pointBudget - Total points available (e.g., 15, 20, 25)
 * @param {Object} options - Build preferences
 * @param {string} options.playstyle - 'aggressive', 'defensive', 'balanced', 'ranged'
 * @param {string} options.name - Character name (default: Generated)
 * @returns {Object} Generated character with equipment and skills
 */
function generateCharacter(pointBudget, options = {}) {
  const playstyle = options.playstyle || 'balanced';
  const name = options.name || `Generated ${playstyle.charAt(0).toUpperCase() + playstyle.slice(1)} Fighter`;

  const character = {
    name: name,
    type: 'Generated',
    subtype: 'Human',
    baseAC: 6,
    equipment: [],
    skills: [],
    pointsSpent: 0,
    pointBudget: pointBudget
  };

  let remainingPoints = pointBudget;
  const maxSkillPoints = 18; // Hard cap at 18 skill points
  let skillPointsSpent = 0;

  // Step 1: Choose primary weapon based on playstyle
  let primaryWeapon = null;

  if (playstyle === 'aggressive') {
    // High damage weapons
    const aggressiveWeapons = EQUIPMENT_DATABASE.weapons.filter(w => w.die >= 8 && w.cost <= remainingPoints);
    primaryWeapon = aggressiveWeapons.sort((a, b) => b.die - a.die)[0];
  } else if (playstyle === 'defensive') {
    // Balanced weapons with defensive options
    const defensiveWeapons = EQUIPMENT_DATABASE.weapons.filter(w => w.die >= 6 && w.die <= 8 && w.cost <= remainingPoints);
    primaryWeapon = defensiveWeapons[Math.floor(defensiveWeapons.length / 2)];
  } else if (playstyle === 'ranged') {
    // Ranged weapons
    const rangedWeapons = EQUIPMENT_DATABASE.weapons.filter(w => w.tags.some(t => t.includes('ranged')) && w.cost <= remainingPoints);
    primaryWeapon = rangedWeapons.sort((a, b) => b.die - a.die)[0];
  } else {
    // Balanced - good all-around weapon
    const balancedWeapons = EQUIPMENT_DATABASE.weapons.filter(w => w.die === 8 && w.cost <= remainingPoints);
    primaryWeapon = balancedWeapons[0] || EQUIPMENT_DATABASE.weapons.filter(w => w.cost <= remainingPoints)[0];
  }

  if (primaryWeapon && primaryWeapon.cost <= remainingPoints) {
    character.equipment.push({
      name: primaryWeapon.name,
      type: 'weapon',
      die: primaryWeapon.die,
      slots: primaryWeapon.slots,
      tags: primaryWeapon.tags
    });
    remainingPoints -= primaryWeapon.cost;
    character.pointsSpent += primaryWeapon.cost;
  }

  // Step 2: Add armor based on playstyle
  const armorBudget = playstyle === 'aggressive' ? Math.floor(remainingPoints * 0.3) : Math.floor(remainingPoints * 0.5);
  let armorPoints = 0;

  // Prioritize high AC armor
  const sortedArmor = [...EQUIPMENT_DATABASE.armor].sort((a, b) => (b.ac / b.cost) - (a.ac / a.cost));

  for (const armor of sortedArmor) {
    if (armorPoints + armor.cost <= armorBudget && armor.cost <= remainingPoints) {
      character.equipment.push({
        name: armor.name,
        type: 'armor',
        ac: armor.ac,
        slots: armor.slots
      });
      remainingPoints -= armor.cost;
      armorPoints += armor.cost;
      character.pointsSpent += armor.cost;
    }
  }

  // Step 3: Add skills based on playstyle and synergy
  const skillPreferences = {
    aggressive: { attack: 0.7, defense: 0.2, tenacity: 0.1 },
    defensive: { attack: 0.3, defense: 0.5, tenacity: 0.2 },
    balanced: { attack: 0.4, defense: 0.4, tenacity: 0.2 },
    ranged: { attack: 0.6, defense: 0.3, tenacity: 0.1 }
  };

  const prefs = skillPreferences[playstyle];
  const attackSkillCount = Math.floor(maxSkillPoints * prefs.attack);
  const defenseSkillCount = Math.floor(maxSkillPoints * prefs.defense);
  const tenacitySkillCount = Math.floor(maxSkillPoints * prefs.tenacity);

  // Add attack skills
  const weaponTags = character.equipment.find(e => e.type === 'weapon')?.tags || [];
  const isPrecise = weaponTags.includes('precise') || primaryWeapon?.name.includes('Sword') || primaryWeapon?.name.includes('Bow');
  const isSwept = weaponTags.includes('swept') || primaryWeapon?.name.includes('Scimitar');
  const isBrutish = weaponTags.includes('brutish') || primaryWeapon?.name.includes('Hammer');
  const isRanged = weaponTags.some(t => t.includes('ranged'));

  let addedAttackSkills = 0;
  if (isPrecise && addedAttackSkills < attackSkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
    character.skills.push({ name: 'Surgical', type: 'attack', slots: 1 });
    remainingPoints -= 1;
    skillPointsSpent += 1;
    character.pointsSpent += 1;
    addedAttackSkills++;
  }

  if (isSwept && addedAttackSkills < attackSkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
    character.skills.push({ name: 'Melee', type: 'attack', slots: 1 });
    remainingPoints -= 1;
    skillPointsSpent += 1;
    character.pointsSpent += 1;
    addedAttackSkills++;
  }

  if (isBrutish && addedAttackSkills < attackSkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
    character.skills.push({ name: 'All In', type: 'attack', slots: 1 });
    remainingPoints -= 1;
    skillPointsSpent += 1;
    character.pointsSpent += 1;
    addedAttackSkills++;
  }

  if (isRanged && isPrecise && addedAttackSkills < attackSkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
    character.skills.push({ name: 'Take Aim', type: 'attack', slots: 1 });
    remainingPoints -= 1;
    skillPointsSpent += 1;
    character.pointsSpent += 1;
    addedAttackSkills++;
  }

  // Add versatile attack skills if we still have room
  if (addedAttackSkills < attackSkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
    character.skills.push({ name: 'Feint', type: 'attack', slots: 1 });
    remainingPoints -= 1;
    skillPointsSpent += 1;
    character.pointsSpent += 1;
    addedAttackSkills++;
  }

  // Add defense skills
  let addedDefenseSkills = 0;
  const defenseSkillPriority = playstyle === 'defensive'
    ? ['Counter Strike', 'Moving Target', 'Brace']
    : ['Moving Target', 'Counter Strike', 'Brace'];

  for (const skillName of defenseSkillPriority) {
    if (addedDefenseSkills < defenseSkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
      character.skills.push({ name: skillName, type: 'defense', slots: 1 });
      remainingPoints -= 1;
      skillPointsSpent += 1;
      character.pointsSpent += 1;
      addedDefenseSkills++;
    }
  }

  // Add tenacity skills
  let addedTenacitySkills = 0;
  const tenacityPriority = ['Grit', 'Flesh Wound'];

  for (const skillName of tenacityPriority) {
    if (addedTenacitySkills < tenacitySkillCount && skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1) {
      character.skills.push({ name: skillName, type: 'tenacity', slots: 1 });
      remainingPoints -= 1;
      skillPointsSpent += 1;
      character.pointsSpent += 1;
      addedTenacitySkills++;
    }
  }

  // Step 4: Spend remaining points on additional armor or secondary weapon
  if (remainingPoints >= 5 && playstyle === 'aggressive') {
    // Try to add a secondary weapon for dual wielding
    const secondaryWeapons = EQUIPMENT_DATABASE.weapons.filter(w => w.die <= 6 && w.cost <= remainingPoints);
    if (secondaryWeapons.length > 0) {
      const secondary = secondaryWeapons[0];
      character.equipment.push({
        name: secondary.name,
        type: 'weapon',
        die: secondary.die,
        slots: secondary.slots,
        tags: secondary.tags
      });
      remainingPoints -= secondary.cost;
      character.pointsSpent += secondary.cost;

      // Add dual wielding skill if we have room
      if (skillPointsSpent + 1 <= maxSkillPoints && remainingPoints >= 1 && !character.skills.some(s => s.name === 'Dual Wielding')) {
        character.skills.push({ name: 'Dual Wielding', type: 'attack', slots: 1 });
        remainingPoints -= 1;
        skillPointsSpent += 1;
        character.pointsSpent += 1;
      }
    }
  } else if (remainingPoints >= 1) {
    // Add more armor with remaining points
    const affordableArmor = EQUIPMENT_DATABASE.armor.filter(a => a.cost <= remainingPoints);
    for (const armor of affordableArmor) {
      if (remainingPoints >= armor.cost) {
        character.equipment.push({
          name: armor.name,
          type: 'armor',
          ac: armor.ac,
          slots: armor.slots
        });
        remainingPoints -= armor.cost;
        character.pointsSpent += armor.cost;
      }
    }
  }

  // Calculate final stats
  character.finalAC = character.baseAC + character.equipment
    .filter(e => e.type === 'armor')
    .reduce((sum, a) => sum + (a.ac || 0), 0);

  character.synergy = evaluateSynergy(character.equipment, character.skills);
  character.remainingPoints = remainingPoints;

  return character;
}

/**
 * Generates and compares multiple character builds
 */
function generateBuildComparison(pointBudget) {
  const builds = {
    aggressive: generateCharacter(pointBudget, { playstyle: 'aggressive', name: 'Aggressive Build' }),
    defensive: generateCharacter(pointBudget, { playstyle: 'defensive', name: 'Defensive Build' }),
    balanced: generateCharacter(pointBudget, { playstyle: 'balanced', name: 'Balanced Build' }),
    ranged: generateCharacter(pointBudget, { playstyle: 'ranged', name: 'Ranged Build' })
  };

  return builds;
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

// Import auth initialization
import { initializeAuth } from './auth-init.js';

// Navigation and UI functionality
document.addEventListener('DOMContentLoaded', () => {
  // Initialize authentication
  initializeAuth();

  // Mobile menu toggle
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('sidebar');

  if (mobileMenuToggle && sidebar) {
    mobileMenuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });

    // Close sidebar when clicking a nav link on mobile
    const navItems = sidebar.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('active');
        }
      });
    });

    // Ensure external links (like /cards.html) navigate immediately
    document.querySelectorAll('.nav-item:not([href^="#"])').forEach(link => {
      link.addEventListener('click', (e) => {
        // Allow default navigation behavior for external links
        // Just close mobile menu if needed
        if (window.innerWidth <= 768) {
          const sidebar = document.querySelector('.sidebar-nav');
          if (sidebar) {
            sidebar.classList.remove('active');
          }
        }
        // Don't preventDefault - let the link navigate naturally
      });
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 &&
          !sidebar.contains(e.target) &&
          !mobileMenuToggle.contains(e.target) &&
          sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
      }
    });
  }

  // Active navigation highlighting
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');

  function highlightNavigation() {
    let currentSection = '';

    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.clientHeight;

      if (window.scrollY >= sectionTop - 100) {
        currentSection = section.getAttribute('id');
      }
    });

    navItems.forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('href') === `#${currentSection}`) {
        item.classList.add('active');
      }
    });
  }

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
        highlightNavigation();
      }
    });
  });

  // Highlight navigation on scroll
  window.addEventListener('scroll', highlightNavigation);
  highlightNavigation(); // Initial highlight

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
