// Comic viewer with responsive layout (CBZ/CBR)
import JSZip from 'jszip';

let pages = [];
let currentPage = 0;
let currentLayout = null;

/**
 * Initialize Comic viewer
 * @param {string} fileURL - Comic file URL
 * @param {Object} document - Document metadata
 */
export async function initComicViewer(fileURL, document) {
  try {
    // Fetch and extract comic archive
    const response = await fetch(fileURL);
    const arrayBuffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Extract image files
    const imageFiles = Object.keys(zip.files)
      .filter((filename) => {
        const ext = filename.split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
      })
      .sort();

    // Load image blobs
    pages = await Promise.all(
      imageFiles.map(async (filename) => {
        const file = zip.files[filename];
        const blob = await file.async('blob');
        return URL.createObjectURL(blob);
      })
    );

    if (pages.length === 0) {
      throw new Error('No images found in comic archive');
    }

    // Set up controls
    setupComicControls(document.name);

    // Load first page
    await loadPage(0);
  } catch (error) {
    console.error('Comic loading error:', error);
    throw error;
  }
}

/**
 * Set up comic controls
 * @param {string} title - Comic title
 */
function setupComicControls(title) {
  // Set titles (both sidebar and header)
  document.getElementById('comicTitleSidebar').textContent = title;
  document.getElementById('comicTitleHeader').textContent = title;

  // Sidebar controls (portrait layout)
  document.getElementById('comicPrevPageSidebar').addEventListener('click', prevPage);
  document.getElementById('comicNextPageSidebar').addEventListener('click', nextPage);

  // Footer controls (landscape layout)
  document.getElementById('comicPrevPageFooter').addEventListener('click', prevPage);
  document.getElementById('comicNextPageFooter').addEventListener('click', nextPage);
}

/**
 * Load a comic page
 * @param {number} pageIndex - Page index
 */
async function loadPage(pageIndex) {
  if (pageIndex < 0 || pageIndex >= pages.length) return;

  currentPage = pageIndex;

  const img = document.getElementById('comicImage');
  const loading = document.getElementById('comicImageLoading');

  // Show loading
  loading.hidden = false;
  img.hidden = true;

  // Load image
  img.src = pages[pageIndex];

  // Wait for image to load to determine layout
  await new Promise((resolve, reject) => {
    img.onload = () => {
      loading.hidden = true;
      img.hidden = false;

      // Determine layout based on aspect ratio
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      updateLayout(aspectRatio);

      resolve();
    };
    img.onerror = () => {
      loading.hidden = true;
      reject(new Error('Failed to load image'));
    };
  });

  // Update page info
  updatePageInfo();
}

/**
 * Update layout based on image aspect ratio
 * @param {number} aspectRatio - Image aspect ratio
 */
function updateLayout(aspectRatio) {
  const viewer = document.getElementById('comicViewer');
  const sidebar = document.getElementById('comicSidebar');
  const header = document.getElementById('comicHeader');
  const footer = document.getElementById('comicFooter');

  // Portrait: aspect ratio < 1.0
  // Landscape: aspect ratio >= 1.0
  const isPortrait = aspectRatio < 1.0;

  if (isPortrait) {
    // Vertical layout with sidebar on right
    viewer.className = 'comic-viewer layout-portrait';
    sidebar.hidden = false;
    header.hidden = true;
    footer.hidden = true;
    currentLayout = 'portrait';
  } else {
    // Horizontal layout with header/footer
    viewer.className = 'comic-viewer layout-landscape';
    sidebar.hidden = true;
    header.hidden = false;
    footer.hidden = false;
    currentLayout = 'landscape';
  }
}

/**
 * Update page info display
 */
function updatePageInfo() {
  const pageInfo = `${currentPage + 1} / ${pages.length}`;
  document.getElementById('comicPageInfoSidebar').textContent = pageInfo;
  document.getElementById('comicPageInfoHeader').textContent = pageInfo;
}

/**
 * Navigate to next page
 */
function nextPage() {
  if (currentPage < pages.length - 1) {
    loadPage(currentPage + 1);
  }
}

/**
 * Navigate to previous page
 */
function prevPage() {
  if (currentPage > 0) {
    loadPage(currentPage - 1);
  }
}

/**
 * Navigate to next page (keyboard shortcut)
 */
export function comicNextPage() {
  nextPage();
}

/**
 * Navigate to previous page (keyboard shortcut)
 */
export function comicPrevPage() {
  prevPage();
}

// Handle window resize to recalculate layout
window.addEventListener('resize', () => {
  const img = document.getElementById('comicImage');
  if (img.complete && img.naturalWidth) {
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    updateLayout(aspectRatio);
  }
});
