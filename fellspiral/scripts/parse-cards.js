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
let rulesContent;
try {
  rulesContent = readFileSync(rulesPath, 'utf-8');
} catch (error) {
  console.error(`\n❌ Failed to read rules.md from ${rulesPath}:`, error.message);
  console.error('Ensure the file exists and is readable.');
  process.exit(1);
}

// Parse markdown tables to extract cards
function parseCards(content) {
  const cards = [];
  const cardMap = new Map(); // Track cards by ID to detect duplicates and resolve title collisions
  let duplicatesSkipped = 0;
  let validationSkipped = 0;
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
        // Don't clear subtype - type and subtype are set independently from separate headers
        // This allows "# Equipment: Weapons" to set both type=Equipment and subtype=Weapons
      }
      // Subtype headers (# Weapons, # Armor, # Attack, etc.)
      else if (
        header.match(/^(Weapons?|Armors?|Attack|Defense|Tenacity|Core|Undead|Vampire|Human)$/)
      ) {
        // Normalize plural forms to singular (e.g., "Weapons" -> "Weapon")
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
      headers = line
        .split('|')
        .map((h) => h.trim())
        .filter((h) => h);
      continue;
    }

    // Skip separator line
    if (line.match(/^\|[-\s|]+\|$/)) {
      continue;
    }

    // Parse table rows
    if (inTable && line.startsWith('|')) {
      const values = line
        .split('|')
        .map((v) => v.trim())
        .filter((v) => v);

      // Allow rows with at least 1 column (title is required, type/subtype can be inferred from headers)
      if (values.length >= 1 && values[0]) {
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
                .map((t) => t.replace(/^-\s+/, '').trim())
                .filter((t) => t);
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
          // Validate required fields
          if (!card.type) {
            console.warn(`⚠️  Warning: Card "${card.title}" is missing type field, skipping`);
            validationSkipped++;
            continue;
          }
          if (!card.subtype) {
            console.warn(`⚠️  Warning: Card "${card.title}" is missing subtype field, skipping`);
            validationSkipped++;
            continue;
          }

          // Generate a base ID from card title (lowercase, alphanumeric only, hyphens for separators)
          const baseId = card.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          let id = baseId;
          let counter = 1;

          /**
           * Duplicate detection strategy:
           * - If we've seen this ID before, check if it's the SAME card (matching type, subtype, description)
           * - Same card = true duplicate, skip it (prevents redundant entries from being listed in multiple sections)
           * - Different card with same title = collision, append numeric suffix to ID (handles edge cases like "Armor" appearing as both Equipment and Skill)
           */
          // Handle ID collisions: skip true duplicates (same data), append suffix for different cards with same title
          if (cardMap.has(id)) {
            const existingCard = cardMap.get(id);
            // Check if it's the same card (same type, subtype, description)
            const isSameCard =
              existingCard.type === card.type &&
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
              console.log(`  Skipping duplicate: ${card.title} (${card.type} - ${card.subtype})`);
              duplicatesSkipped++;
              continue;
            }
          }

          card.id = id;

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

  return { cards, duplicatesSkipped, validationSkipped };
}

// Only run main script if executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse cards
  const { cards, duplicatesSkipped, validationSkipped } = parseCards(rulesContent);

  // Validate failure rate isn't too high (indicates problem with source data)
  const totalAttempted = cards.length + validationSkipped;

  if (totalAttempted === 0) {
    console.error('\n❌ No cards found in rules.md');
    console.error('Check that rules.md contains properly formatted markdown tables.');
    process.exit(1);
  }

  const failureRate = validationSkipped / (totalAttempted || 1);
  if (failureRate > 0.1) {
    console.error(
      `\n❌ Too many validation failures (${validationSkipped}/${totalAttempted} cards failed)`
    );
    console.error('This indicates a problem with the source data in rules.md');
    process.exit(1);
  }

  // Log summary
  console.log(`\nParsed ${cards.length} cards from rules.md`);
  if (duplicatesSkipped > 0) {
    console.log(`  (Skipped ${duplicatesSkipped} duplicates)`);
  }
  if (validationSkipped > 0) {
    console.log(`  (Skipped ${validationSkipped} cards with missing required fields)`);
  }
  console.log('');

  // Group by type
  const cardsByType = {};
  let typeGroupingErrors = 0;
  cards.forEach((card) => {
    if (!card || typeof card !== 'object') {
      console.warn(`⚠️  Warning: Invalid card object encountered, skipping`);
      typeGroupingErrors++;
      return;
    }

    const type = card.type || 'Unknown';
    if (!cardsByType[type]) {
      cardsByType[type] = [];
    }
    cardsByType[type].push(card);
  });

  if (typeGroupingErrors > 0) {
    console.warn(
      `⚠️  ${typeGroupingErrors} card(s) could not be categorized by type. Statistics may be incomplete.\n`
    );
  }

  console.log('Cards by type:');
  let subtypeGroupingErrors = 0;
  Object.keys(cardsByType).forEach((type) => {
    console.log(`  ${type}: ${cardsByType[type].length}`);

    // Group by subtype
    const bySubtype = {};
    cardsByType[type].forEach((card) => {
      if (!card || typeof card !== 'object') {
        console.warn(`⚠️  Warning: Invalid card object encountered, skipping`);
        subtypeGroupingErrors++;
        return;
      }

      const subtype = card.subtype || 'Unknown';
      if (!bySubtype[subtype]) {
        bySubtype[subtype] = 0;
      }
      bySubtype[subtype]++;
    });

    Object.keys(bySubtype).forEach((subtype) => {
      console.log(`    ${subtype}: ${bySubtype[subtype]}`);
    });
  });

  if (subtypeGroupingErrors > 0) {
    console.warn(
      `⚠️  ${subtypeGroupingErrors} card(s) could not be categorized by subtype. Statistics may be incomplete.\n`
    );
  }

  // Output JSON
  const outputPath = join(__dirname, '../site/src/data/cards.json');
  const outputDir = dirname(outputPath);

  // Create directory if it doesn't exist
  try {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
  } catch (error) {
    console.error(`\n❌ Failed to create output directory ${outputDir}:`, error.message);
    process.exit(1);
  }

  try {
    writeFileSync(outputPath, JSON.stringify(cards, null, 2));
    console.log(`\n✅ Cards saved to: ${outputPath}\n`);
  } catch (error) {
    console.error(`\n❌ Failed to write cards.json to ${outputPath}:`, error.message);
    process.exit(1);
  }

  // Also create a summary file
  const summary = {
    totalCards: cards.length,
    cardsByType: {},
    cardsBySubtype: {},
    lastUpdated: new Date().toISOString(),
  };

  let summaryErrors = 0;
  cards.forEach((card) => {
    if (!card || typeof card !== 'object') {
      console.warn(`⚠️  Warning: Invalid card object encountered, skipping`);
      summaryErrors++;
      return;
    }

    const type = card.type || 'Unknown';
    const subtype = card.subtype || 'Unknown';

    summary.cardsByType[type] = (summary.cardsByType[type] || 0) + 1;
    summary.cardsBySubtype[subtype] = (summary.cardsBySubtype[subtype] || 0) + 1;
  });

  if (summaryErrors > 0) {
    console.warn(
      `⚠️  ${summaryErrors} card(s) could not be added to summary. Summary statistics may be incomplete.\n`
    );
  }

  const summaryPath = join(__dirname, '../site/src/data/cards-summary.json');
  try {
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`✅ Summary saved to: ${summaryPath}\n`);
  } catch (error) {
    console.error(`\n❌ Failed to write summary to ${summaryPath}:`, error.message);
    process.exit(1);
  }

  const totalWarnings = typeGroupingErrors + subtypeGroupingErrors + summaryErrors;
  if (totalWarnings > 0) {
    console.warn(
      `\n⚠️  Completed with ${totalWarnings} warning(s) - some cards may not be fully categorized.`
    );
  }
}

export { parseCards };
