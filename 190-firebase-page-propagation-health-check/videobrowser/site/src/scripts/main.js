/**
 * Video Browser - Main Application
 * Fetches and displays videos from Firebase Storage: rml-media/video
 */

import { initializeApp } from 'firebase/app';
import { getStorage, ref, listAll, getDownloadURL, getMetadata } from 'firebase/storage';
import { firebaseConfig } from '../firebase-config.js';
import { initializeAuth } from './auth-init.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

// Configuration
const VIDEO_PREFIX = 'video/';

// State
let allVideos = [];
let currentVideo = null;

// DOM Elements
const videoPlayer = document.getElementById('videoPlayer');
const videoInfo = document.getElementById('videoInfo');
const fileList = document.getElementById('fileList');
const loadingIndicator = document.getElementById('loadingIndicator');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const totalCount = document.getElementById('totalCount');

/**
 * Formats bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Formats ISO date string to readable format
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Gets the display name from a full path
 */
function getDisplayName(name) {
  return name.replace(VIDEO_PREFIX, '');
}

/**
 * Fetches video list from Firebase Storage
 */
async function fetchVideos() {
  try {
    // Create reference to video directory
    const videosRef = ref(storage, VIDEO_PREFIX);

    // List all items in the video directory
    const result = await listAll(videosRef);

    // Filter to only video files and get metadata + signed URLs
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];

    const videoPromises = result.items
      .filter(itemRef => {
        const name = itemRef.name.toLowerCase();
        return videoExtensions.some(ext => name.endsWith(ext));
      })
      .map(async (itemRef) => {
        try {
          // Get metadata and download URL in parallel
          const [metadata, downloadUrl] = await Promise.all([
            getMetadata(itemRef),
            getDownloadURL(itemRef)
          ]);

          return {
            name: itemRef.fullPath,
            displayName: getDisplayName(itemRef.fullPath),
            size: parseInt(metadata.size, 10),
            updated: metadata.updated,
            contentType: metadata.contentType,
            downloadUrl: downloadUrl, // Signed URL from Firebase
            ref: itemRef // Keep reference for future operations
          };
        } catch (error) {
          console.error(`Error fetching metadata for ${itemRef.name}:`, error);
          return null;
        }
      });

    // Wait for all metadata fetches to complete
    const videos = (await Promise.all(videoPromises))
      .filter(video => video !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return videos;
  } catch (error) {
    throw new Error(`Error fetching videos: ${error.message}`);
  }
}

/**
 * Renders the file list
 */
function renderFileList(videos) {
  fileList.innerHTML = '';

  if (videos.length === 0) {
    fileList.innerHTML = `
      <div class="empty-state">
        <p>No videos found</p>
      </div>
    `;
    return;
  }

  videos.forEach(video => {
    const item = document.createElement('div');
    item.className = 'file-item';
    if (currentVideo && currentVideo.name === video.name) {
      item.classList.add('file-item--active');
    }

    item.innerHTML = `
      <div class="file-item__name">${escapeHtml(video.displayName)}</div>
      <div class="file-item__meta">
        <span>${formatBytes(video.size)}</span>
        <span>${formatDate(video.updated)}</span>
      </div>
    `;

    item.addEventListener('click', () => playVideo(video));
    fileList.appendChild(item);
  });
}

/**
 * Plays a video
 */
function playVideo(video) {
  currentVideo = video;

  // Update video player with signed URL from Firebase
  videoPlayer.src = video.downloadUrl;
  videoPlayer.load();

  // Update video info
  videoInfo.innerHTML = `
    <div class="video-info__title">${escapeHtml(video.displayName)}</div>
    <div class="video-info__details">
      Size: ${formatBytes(video.size)} |
      Updated: ${formatDate(video.updated)}
    </div>
  `;

  // Re-render file list to update active state
  const searchTerm = searchInput.value.toLowerCase().trim();
  const filtered = searchTerm
    ? allVideos.filter(v => v.displayName.toLowerCase().includes(searchTerm))
    : allVideos;
  renderFileList(filtered);
}

/**
 * Filters videos based on search term
 */
function filterVideos() {
  const searchTerm = searchInput.value.toLowerCase().trim();
  const filtered = searchTerm
    ? allVideos.filter(v => v.displayName.toLowerCase().includes(searchTerm))
    : allVideos;

  renderFileList(filtered);
  totalCount.textContent = filtered.length;
}

/**
 * Loads videos from GCS
 */
async function loadVideos() {
  try {
    // Show loading state
    loadingIndicator.classList.remove('hidden');
    fileList.innerHTML = '';
    refreshBtn.disabled = true;

    // Fetch videos
    allVideos = await fetchVideos();

    // Update UI
    totalCount.textContent = allVideos.length;
    renderFileList(allVideos);

    // Hide loading
    loadingIndicator.classList.add('hidden');
    refreshBtn.disabled = false;

  } catch (error) {
    loadingIndicator.classList.add('hidden');
    refreshBtn.disabled = false;

    // Show error
    fileList.innerHTML = `
      <div class="error">
        <div class="error__title">Failed to load videos</div>
        <p>${escapeHtml(error.message)}</p>
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">
          Make sure Firebase Storage is configured correctly and the storage bucket has the video/ directory.
        </p>
      </div>
    `;
  }
}

/**
 * Escapes HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Space: play/pause
    if (e.code === 'Space' && document.activeElement !== searchInput) {
      e.preventDefault();
      if (videoPlayer.paused) {
        videoPlayer.play();
      } else {
        videoPlayer.pause();
      }
    }

    // Arrow keys: skip forward/backward
    if (e.code === 'ArrowLeft' && !videoPlayer.paused) {
      videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
    }
    if (e.code === 'ArrowRight' && !videoPlayer.paused) {
      videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 5);
    }

    // Up/Down: navigate video list
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      if (document.activeElement !== searchInput) {
        e.preventDefault();
        navigateVideoList(e.code === 'ArrowUp' ? -1 : 1);
      }
    }
  });
}

/**
 * Navigate video list with keyboard
 */
function navigateVideoList(direction) {
  if (allVideos.length === 0) return;

  const currentIndex = currentVideo
    ? allVideos.findIndex(v => v.name === currentVideo.name)
    : -1;

  let nextIndex = currentIndex + direction;

  // Wrap around
  if (nextIndex < 0) nextIndex = allVideos.length - 1;
  if (nextIndex >= allVideos.length) nextIndex = 0;

  playVideo(allVideos[nextIndex]);
}

/**
 * Initialize the application
 */
async function init() {
  // Initialize authentication
  initializeAuth();

  // Setup event listeners
  refreshBtn.addEventListener('click', loadVideos);
  searchInput.addEventListener('input', filterVideos);

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Initial load
  await loadVideos();
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
