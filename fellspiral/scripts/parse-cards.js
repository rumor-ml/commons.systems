#!/usr/bin/env node
/**
 * Parse cards from rules.md and generate structured JSON data
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read rules.md
const rulesPath = join(__dirname, '../rules.md');
const rulesContent = readFileSync(rulesPath, 'utf-8');

// Parse markdown tables to extract cards
function parseCards(content) {
  const cards = [];
  const cardMap = new Map(); // Track unique cards by ID
  const lines = content.split('\n');

  let currentType = null;
  let currentSubtype = null;
  let inTable = false;
  let headers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect section headers to determine type/subtype
    if (line.startsWith('# ')) {
      const header = line.substring(2).trim();

      // Type headers (Equipment:, Skill:, Upgrade:, etc.)
      if (header.match(/^(Equipment|Upgrade|Skill|Foe|Origin):/)) {
        const parts = header.split(':');
        currentType = parts[0].trim();
        // Don't clear subtype yet - next line might specify it
        // currentSubtype = null;
      }
      // Subtype headers (# Weapons, # Armor, # Attack, etc.)
      else if (header.match(/^(Weapons?|Armors?|Attack|Defense|Tenacity|Core|Undead|Vampire|Human)$/)) {
        currentSubtype = header.replace(/s$/, ''); // Remove trailing 's'
      }
      // Standalone type headers (Equipment, Skill, etc.)
      else if (header.match(/^(Equipment|Upgrade|Skill|Foe|Origin)$/)) {
        currentType = header;
      }
    }

    // Detect table headers
    if (line.startsWith('| title |')) {
      inTable = true;
      headers = line.split('|').map(h => h.trim()).filter(h => h);
      continue;
    }

    // Skip separator line
    if (line.match(/^\|[-\s|]+\|$/)) {
      continue;
    }

    // Parse table rows
    if (inTable && line.startsWith('|')) {
      const values = line.split('|').map(v => v.trim()).filter(v => v);

      // Allow rows with at least 3 columns (title, type, subtype minimum)
      if (values.length >= 3 && values[0]) {
        const card = {};

        headers.forEach((header, index) => {
          let value = values[index] || '';

          // Clean up title (remove leading # and extra spaces)
          if (header === 'title') {
            value = value.replace(/^#\s+/, '').trim();
          }

          // Parse tags (convert from markdown list to array)
          if (header === 'tags') {
            if (value.includes('- ')) {
              card.tags = value
                .replace(/<br>/g, '\n')
                .split('\n')
                .map(t => t.replace(/^-\s+/, '').trim())
                .filter(t => t);
            } else {
              card.tags = value ? [value] : [];
            }
          } else {
            card[header] = value;
          }
        });

        // Infer type and subtype from card data or context
        if (card.type) {
          currentType = card.type;
        }
        if (card.subtype) {
          currentSubtype = card.subtype;
        }

        if (!card.type && currentType) {
          card.type = currentType;
        }
        if (!card.subtype && currentSubtype) {
          card.subtype = currentSubtype;
        }

        // Only add cards that have a title
        if (card.title) {
          // Generate a unique ID
          const baseId = card.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          let id = baseId;
          let counter = 1;

          // Ensure unique IDs by adding a suffix if needed
          // But check if it's truly a duplicate or just the same card appearing multiple times
          if (cardMap.has(id)) {
            const existingCard = cardMap.get(id);
            // Check if it's the same card (same type, subtype, description)
            const isSameCard = existingCard.type === card.type &&
                              existingCard.subtype === card.subtype &&
                              existingCard.description === card.description;

            if (!isSameCard) {
              // Different card with same name - add suffix
              while (cardMap.has(id)) {
                id = `${baseId}-${counter}`;
                counter++;
              }
            } else {
              // Same card appearing multiple times - skip it
              continue;
            }
          }

          card.id = id;

          // Add timestamps
          card.createdAt = new Date().toISOString();
          card.updatedAt = new Date().toISOString();

          cardMap.set(id, card);
          cards.push(card);
        }
      }
    } else if (inTable && !line.startsWith('|')) {
      // End of table
      inTable = false;
    }
  }

  return cards;
}

// Parse cards
const cards = parseCards(rulesContent);

// Log summary
console.log(`\nParsed ${cards.length} cards from rules.md\n`);

// Group by type
const cardsByType = {};
cards.forEach(card => {
  const type = card.type || 'Unknown';
  if (!cardsByType[type]) {
    cardsByType[type] = [];
  }
  cardsByType[type].push(card);
});

console.log('Cards by type:');
Object.keys(cardsByType).forEach(type => {
  console.log(`  ${type}: ${cardsByType[type].length}`);

  // Group by subtype
  const bySubtype = {};
  cardsByType[type].forEach(card => {
    const subtype = card.subtype || 'Unknown';
    if (!bySubtype[subtype]) {
      bySubtype[subtype] = 0;
    }
    bySubtype[subtype]++;
  });

  Object.keys(bySubtype).forEach(subtype => {
    console.log(`    ${subtype}: ${bySubtype[subtype]}`);
  });
});

// Output JSON
const outputPath = join(__dirname, '../site/src/data/cards.json');
const outputDir = dirname(outputPath);

// Create directory if it doesn't exist
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

writeFileSync(outputPath, JSON.stringify(cards, null, 2));
console.log(`\n✅ Cards saved to: ${outputPath}\n`);

// Also create a summary file
const summary = {
  totalCards: cards.length,
  cardsByType: {},
  cardsBySubtype: {},
  lastUpdated: new Date().toISOString()
};

cards.forEach(card => {
  const type = card.type || 'Unknown';
  const subtype = card.subtype || 'Unknown';

  summary.cardsByType[type] = (summary.cardsByType[type] || 0) + 1;
  summary.cardsBySubtype[subtype] = (summary.cardsBySubtype[subtype] || 0) + 1;
});

const summaryPath = join(__dirname, '../site/src/data/cards-summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`✅ Summary saved to: ${summaryPath}\n`);
