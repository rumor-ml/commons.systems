/**
 * PDF Export Module with Saddle-Stitch Booklet Ordering
 *
 * This module implements the complex booklet imposition logic for creating
 * print-ready PDFs optimized for saddle-stitch binding.
 */

import { jsPDF } from 'jspdf';

// PDF dimensions for digest-size booklet (5.5" x 8.5" portrait)
const DIGEST_WIDTH_INCHES = 5.5;
const DIGEST_HEIGHT_INCHES = 8.5;
const DPI = 72; // PDF standard DPI

// Convert to points (PDF units)
const DIGEST_WIDTH = DIGEST_WIDTH_INCHES * DPI;
const DIGEST_HEIGHT = DIGEST_HEIGHT_INCHES * DPI;

// Landscape page dimensions (two digest pages side-by-side)
const PAGE_WIDTH = DIGEST_HEIGHT * 2;  // 17" landscape
const PAGE_HEIGHT = DIGEST_WIDTH;       // 5.5" height

/**
 * Calculate booklet page ordering for saddle-stitch binding
 *
 * For a booklet with N pages, this returns an array of objects indicating
 * which pamphlet pages appear on the left and right halves of each physical
 * PDF page.
 *
 * Example: 8-page booklet returns:
 * [
 *   { left: 8, right: 1 },  // Outer spread (page 0 of PDF)
 *   { left: 2, right: 7 },  // (page 1, back of page 0 when printed duplex)
 *   { left: 6, right: 3 },  // (page 2)
 *   { left: 4, right: 5 }   // (page 3, back of page 2)
 * ]
 *
 * @param {number} pageCount - Number of pamphlet pages (must be divisible by 4)
 * @returns {Array<{left: number, right: number}>} Page ordering
 */
export function calculateBookletOrder(pageCount) {
  if (pageCount % 4 !== 0) {
    throw new Error('Page count must be divisible by 4 for saddle-stitch booklets');
  }

  const sheets = pageCount / 4; // Each physical sheet holds 4 pamphlet pages
  const bookletOrder = [];

  for (let sheet = 0; sheet < sheets; sheet++) {
    // Front of sheet (odd PDF page)
    const frontLeft = pageCount - (sheet * 2);
    const frontRight = 1 + (sheet * 2);
    bookletOrder.push({ left: frontLeft, right: frontRight });

    // Back of sheet (even PDF page) - pages are in reverse order
    const backLeft = 2 + (sheet * 2);
    const backRight = pageCount - 1 - (sheet * 2);
    bookletOrder.push({ left: backLeft, right: backRight });
  }

  return bookletOrder;
}

/**
 * Find the opposite page in a duplex booklet
 *
 * In duplex printing, pages at the same position on consecutive odd/even
 * PDF pairs are physically opposite when the sheet is folded.
 *
 * @param {Array<{left: number, right: number}>} bookletOrder - Booklet page order
 * @param {number} pamphletPage - Pamphlet page number
 * @param {string} side - 'left' or 'right'
 * @returns {number|null} Opposite pamphlet page number, or null if not found
 */
export function findOppositePageInBooklet(bookletOrder, pamphletPage, side) {
  // Find the PDF page index where this pamphlet page appears
  const pdfPageIndex = bookletOrder.findIndex(
    page => page[side] === pamphletPage
  );

  if (pdfPageIndex === -1) return null;

  // Calculate opposite PDF page index
  // If on odd PDF page (index 0, 2, 4...), opposite is next (index 1, 3, 5...)
  // If on even PDF page (index 1, 3, 5...), opposite is previous (index 0, 2, 4...)
  const oppositeIndex = pdfPageIndex % 2 === 0 ? pdfPageIndex + 1 : pdfPageIndex - 1;

  if (oppositeIndex < 0 || oppositeIndex >= bookletOrder.length) return null;

  return bookletOrder[oppositeIndex][side];
}

/**
 * Pad page count to next multiple of 4
 * Required for proper saddle-stitch booklet format
 *
 * @param {number} count - Original page count
 * @returns {number} Padded page count
 */
export function padToMultipleOf4(count) {
  const remainder = count % 4;
  if (remainder === 0) return count;
  return count + (4 - remainder);
}

/**
 * Generate digest PDF with saddle-stitch booklet layout
 *
 * @param {Object} options - Export options
 * @param {Array<Object>} options.pages - Array of page objects with content
 * @param {string} options.filename - Output filename
 * @param {string} options.exportType - 'odd' | 'even' | 'sequential'
 * @param {Object} options.defaults - Default front/back cards for empty slots
 * @returns {Promise<jsPDF>} Generated PDF document
 */
export async function generateBookletPDF(options) {
  const { pages, filename = 'booklet.pdf', exportType = 'odd', defaults = {} } = options;

  // Ensure page count is divisible by 4
  const paddedPageCount = padToMultipleOf4(pages.length);
  const paddedPages = [...pages];

  // Add blank pages if needed
  while (paddedPages.length < paddedPageCount) {
    paddedPages.push({ isBlank: true });
  }

  // Calculate booklet ordering
  const bookletOrder = calculateBookletOrder(paddedPageCount);

  // Create PDF in landscape orientation for side-by-side digest pages
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [PAGE_WIDTH, PAGE_HEIGHT]
  });

  // Determine which PDF pages to render based on export type
  let startIndex, step;
  if (exportType === 'odd') {
    // Odd PDF pages: indices 0, 2, 4...
    startIndex = 0;
    step = 2;
  } else if (exportType === 'even') {
    // Even PDF pages: indices 1, 3, 5...
    startIndex = 1;
    step = 2;
  } else {
    // Sequential: all pages
    startIndex = 0;
    step = 1;
  }

  let isFirstPage = true;

  for (let i = startIndex; i < bookletOrder.length; i += step) {
    const pageSpec = bookletOrder[i];

    if (!isFirstPage) {
      pdf.addPage();
    }
    isFirstPage = false;

    // Determine if this is an even PDF page (needs 180° rotation)
    const isEvenPage = i % 2 === 1;

    // Render left half
    if (pageSpec.left > 0 && pageSpec.left <= paddedPages.length) {
      const leftPage = paddedPages[pageSpec.left - 1];
      await renderPageHalf(pdf, leftPage, 'left', isEvenPage, defaults);
    }

    // Render right half
    if (pageSpec.right > 0 && pageSpec.right <= paddedPages.length) {
      const rightPage = paddedPages[pageSpec.right - 1];
      await renderPageHalf(pdf, rightPage, 'right', isEvenPage, defaults);
    }

    // Add page number indicators for debugging (optional)
    if (exportType !== 'sequential') {
      pdf.setFontSize(8);
      pdf.setTextColor(200, 200, 200);
      const label = exportType === 'odd' ? 'ODD' : 'EVEN';
      pdf.text(`${label} - L:${pageSpec.left} R:${pageSpec.right}`, 10, 10);
    }
  }

  return pdf;
}

/**
 * Render one half (left or right) of a landscape PDF page
 *
 * @param {jsPDF} pdf - PDF document
 * @param {Object} page - Page data to render
 * @param {string} side - 'left' or 'right'
 * @param {boolean} rotate180 - Whether to rotate content 180° for duplex printing
 * @param {Object} defaults - Default content for empty slots
 */
async function renderPageHalf(pdf, page, side, rotate180, defaults) {
  const xOffset = side === 'left' ? 0 : DIGEST_HEIGHT;

  if (page.isBlank) {
    // Render blank page
    pdf.setFillColor(255, 255, 255);
    pdf.rect(xOffset, 0, DIGEST_HEIGHT, DIGEST_WIDTH, 'F');
    return;
  }

  // Save graphics state
  pdf.saveGraphicsState();

  if (rotate180) {
    // Translate to page center, rotate, translate back
    const centerX = xOffset + DIGEST_HEIGHT / 2;
    const centerY = DIGEST_WIDTH / 2;
    pdf.setCurrentTransformationMatrix([1, 0, 0, 1, centerX, centerY]);
    pdf.setCurrentTransformationMatrix([-1, 0, 0, -1, 0, 0]);
    pdf.setCurrentTransformationMatrix([1, 0, 0, 1, -centerX, -centerY]);
  }

  // Render background image if present
  if (page.backgroundImage) {
    try {
      pdf.addImage(
        page.backgroundImage,
        'PNG',
        xOffset,
        0,
        DIGEST_HEIGHT,
        DIGEST_WIDTH
      );
    } catch (error) {
      // Fallback to white background
      pdf.setFillColor(255, 255, 255);
      pdf.rect(xOffset, 0, DIGEST_HEIGHT, DIGEST_WIDTH, 'F');
    }
  } else {
    // Default white background
    pdf.setFillColor(255, 255, 255);
    pdf.rect(xOffset, 0, DIGEST_HEIGHT, DIGEST_WIDTH, 'F');
  }

  // Render regions (text and image regions)
  if (page.regions && Array.isArray(page.regions)) {
    for (const region of page.regions) {
      await renderRegion(pdf, region, xOffset, rotate180);
    }
  }

  // Restore graphics state
  pdf.restoreGraphicsState();
}

/**
 * Render a single region (text or image) on the page
 *
 * @param {jsPDF} pdf - PDF document
 * @param {Object} region - Region data
 * @param {number} xOffset - X offset for left/right half
 * @param {boolean} rotate180 - Whether content is rotated
 */
async function renderRegion(pdf, region, xOffset, rotate180) {
  const { type, x, y, width, height, content, zOrder = 0 } = region;

  if (type === 'text' || type === 'markdown') {
    // Render text content
    pdf.setFontSize(region.fontSize || 12);
    pdf.setTextColor(0, 0, 0);

    const textX = xOffset + x;
    const textY = y;

    // Split text into lines that fit within region width
    const lines = pdf.splitTextToSize(content || '', width);
    pdf.text(lines, textX, textY + 15); // +15 for baseline offset

  } else if (type === 'image') {
    // Render image content
    if (region.imageData || region.imageUrl) {
      try {
        const imgX = xOffset + x;
        const imgY = y;

        // Apply crop and zoom if specified
        const cropX = region.cropX || 0;
        const cropY = region.cropY || 0;
        const zoom = region.zoom || 1.0;

        pdf.addImage(
          region.imageData || region.imageUrl,
          'JPEG',
          imgX,
          imgY,
          width,
          height,
          undefined,
          'FAST'
        );
      } catch (error) {
        // Draw placeholder rectangle for failed images
        pdf.setFillColor(240, 240, 240);
        pdf.rect(xOffset + x, y, width, height, 'F');
        pdf.setTextColor(150, 150, 150);
        pdf.text('Image', xOffset + x + 5, y + 15);
      }
    }
  }
}

/**
 * Infer poker card back pages for duplex printing
 * Ensures poker fronts have corresponding backs on opposite side of sheet
 *
 * @param {Array<Object>} pages - All pages in document
 * @param {Array<{left: number, right: number}>} bookletOrder - Booklet ordering
 * @param {Object} defaults - Default front/back cards
 * @returns {Array<Object>} Pages with back pages inserted
 */
export function inferPokerBackPages(pages, bookletOrder, defaults) {
  // This is a simplified version. Full implementation would:
  // 1. Identify poker card grid pages
  // 2. Find available opposite slots
  // 3. Insert corresponding back pages
  // 4. Handle default backs for cards without explicit backs

  // For now, return pages as-is
  // TODO: Implement full poker back inference logic
  return pages;
}

/**
 * Export document as PDF
 *
 * @param {Object} document - Document to export
 * @param {string} exportMode - 'odd' | 'even' | 'sequential' | 'combined'
 * @returns {Promise<void>}
 */
export async function exportDocumentPDF(document, exportMode = 'combined') {
  if (exportMode === 'combined') {
    // Export both odd and even PDFs
    const oddPdf = await generateBookletPDF({
      pages: document.pages,
      filename: `${document.name}-odd.pdf`,
      exportType: 'odd',
      defaults: document.defaults
    });
    oddPdf.save(`${document.name}-odd.pdf`);

    const evenPdf = await generateBookletPDF({
      pages: document.pages,
      filename: `${document.name}-even.pdf`,
      exportType: 'even',
      defaults: document.defaults
    });
    evenPdf.save(`${document.name}-even.pdf`);
  } else {
    const pdf = await generateBookletPDF({
      pages: document.pages,
      filename: `${document.name}.pdf`,
      exportType: exportMode,
      defaults: document.defaults
    });
    pdf.save(`${document.name}.pdf`);
  }
}
