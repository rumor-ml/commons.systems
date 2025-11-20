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
    alive: true
  };

  const combatant2 = {
    name: char2.name,
    currentAC: char2.baseAC + char2.equipment.filter(e => e.type === 'armor').reduce((sum, a) => sum + (a.ac || 0), 0),
    equipmentSlots: [...char2.equipment],
    skillSlots: [...char2.skills],
    alive: true
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

  const defenseRoll = rollDie(20);
  const weaponRoll = rollDie(weapon.die);
  const isCrit = weaponRoll === weapon.die;
  const totalAttack = defenseRoll + weaponRoll;
  const isStrike = totalAttack > defender.currentAC;

  log.push(`${attacker.name} attacks with ${weapon.name}`);
  log.push(`  Defense: ${defenseRoll}, Weapon: ${weaponRoll} (d${weapon.die}), Total: ${totalAttack} vs AC ${defender.currentAC}`);

  if (isStrike) {
    log.push(`  ⚔️ STRIKE! ${isCrit ? '(CRITICAL!)' : ''}`);

    // Apply damage
    if (defender.equipmentSlots.length > 0) {
      const lostItem = defender.equipmentSlots.shift();
      log.push(`  ${defender.name} loses ${lostItem.name}`);

      if (lostItem.type === 'armor') {
        defender.currentAC -= (lostItem.ac || 0);
        log.push(`  ${defender.name}'s AC reduced to ${defender.currentAC}`);
      }
    } else if (defender.skillSlots.length > 0) {
      const lostSkill = defender.skillSlots.shift();
      log.push(`  ${defender.name} loses ${lostSkill.name} skill`);
    } else {
      log.push(`  💀 ${defender.name} takes SHOT TO THE HEART!`);
      defender.alive = false;
    }
  } else {
    log.push(`  🛡️ MISS - Attack didn't exceed AC`);
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
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
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
