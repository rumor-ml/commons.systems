import { hydrateIslands } from '../islands/index.jsx';

// Hydrate React islands when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
  hydrateIslands();
}
