// PDF viewer using PDF.js
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
const workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

let pdfDoc = null;
let currentPage = 1;
let currentScale = 1.0;
let rendering = false;

/**
 * Initialize PDF viewer
 * @param {string} fileURL - PDF file URL
 * @param {Object} document - Document metadata
 */
export async function initPDFViewer(fileURL, document) {
  try {
    // Set title
    document.getElementById('pdfTitle').textContent = document.name;

    // Load PDF
    const loadingTask = pdfjsLib.getDocument(fileURL);
    pdfDoc = await loadingTask.promise;

    // Update page info
    document.getElementById('pdfPageInfo').textContent = `1 / ${pdfDoc.numPages}`;

    // Set up controls
    setupPDFControls();

    // Render first page
    await renderPage(1);

  } catch (error) {
    console.error('PDF loading error:', error);
    throw error;
  }
}

/**
 * Set up PDF controls
 */
function setupPDFControls() {
  document.getElementById('pdfPrevPage').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderPage(currentPage);
    }
  });

  document.getElementById('pdfNextPage').addEventListener('click', () => {
    if (currentPage < pdfDoc.numPages) {
      currentPage++;
      renderPage(currentPage);
    }
  });

  document.getElementById('pdfZoomOut').addEventListener('click', () => {
    currentScale = Math.max(0.5, currentScale - 0.1);
    renderPage(currentPage);
    updateZoomLevel();
  });

  document.getElementById('pdfZoomIn').addEventListener('click', () => {
    currentScale = Math.min(3.0, currentScale + 0.1);
    renderPage(currentPage);
    updateZoomLevel();
  });
}

/**
 * Render a PDF page
 * @param {number} pageNum - Page number
 */
async function renderPage(pageNum) {
  if (rendering) return;
  rendering = true;

  try {
    const page = await pdfDoc.getPage(pageNum);
    const canvas = document.getElementById('pdfCanvas');
    const ctx = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: currentScale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    // Update page info
    document.getElementById('pdfPageInfo').textContent = `${pageNum} / ${pdfDoc.numPages}`;

  } catch (error) {
    console.error('Page rendering error:', error);
  } finally {
    rendering = false;
  }
}

/**
 * Update zoom level display
 */
function updateZoomLevel() {
  document.getElementById('pdfZoomLevel').textContent = `${Math.round(currentScale * 100)}%`;
}

/**
 * Navigate to next page (keyboard shortcut)
 */
export function pdfNextPage() {
  if (currentPage < pdfDoc.numPages) {
    currentPage++;
    renderPage(currentPage);
  }
}

/**
 * Navigate to previous page (keyboard shortcut)
 */
export function pdfPrevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderPage(currentPage);
  }
}
