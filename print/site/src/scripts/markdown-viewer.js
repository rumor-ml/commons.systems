// Markdown viewer using marked.js
import { marked } from 'marked';

/**
 * Initialize Markdown viewer
 * @param {string} fileURL - Markdown file URL
 * @param {Object} document - Document metadata
 */
export async function initMarkdownViewer(fileURL, document) {
  try {
    // Set title
    document.getElementById('markdownTitle').textContent = document.name;

    // Fetch markdown content
    const response = await fetch(fileURL);
    const markdownText = await response.text();

    // Parse and render markdown
    const html = marked.parse(markdownText);
    document.getElementById('markdownContent').innerHTML = html;

  } catch (error) {
    console.error('Markdown loading error:', error);
    throw error;
  }
}
