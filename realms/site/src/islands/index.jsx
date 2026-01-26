import React from 'react';
import { createRoot } from 'react-dom/client';
import MythicBastionlandRealms from './MythicBastionlandRealms.jsx';

// Island registry
const islands = {
  'mythic-bastionland-realms': MythicBastionlandRealms,
};

// Hydrate all islands on the page
export function hydrateIslands() {
  document.querySelectorAll('[data-island]').forEach((element) => {
    const islandName = element.dataset.island;
    const Island = islands[islandName];

    if (Island) {
      const root = createRoot(element);
      root.render(<Island />);
    } else {
      console.warn(`Island "${islandName}" not found in registry`);
    }
  });
}
