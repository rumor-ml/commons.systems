/**
 * Video Browser - Main Application
 * Fetches and displays videos from GCS bucket: rml-media/video
 */

// Configuration
const GCS_BUCKET = 'rml-media';
const VIDEO_PREFIX = 'video/';
const GCS_API_BASE = 'https://storage.googleapis.com/storage/v1/b';

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
 * Fetches video list from GCS bucket
 */
async function fetchVideos() {
  try {
    const url = `${GCS_API_BASE}/${GCS_BUCKET}/o?prefix=${encodeURIComponent(VIDEO_PREFIX)}&delimiter=/`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch videos: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Filter to only video files
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];
    const videos = (data.items || [])
      .filter(item => {
        const name = item.name.toLowerCase();
        return videoExtensions.some(ext => name.endsWith(ext));
      })
      .map(item => ({
        name: item.name,
        displayName: getDisplayName(item.name),
        size: parseInt(item.size, 10),
        updated: item.updated,
        contentType: item.contentType,
        mediaLink: item.mediaLink,
        publicUrl: `https://storage.googleapis.com/${GCS_BUCKET}/${item.name}`
      }))
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

  // Update video player
  videoPlayer.src = video.publicUrl;
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
          Make sure the GCS bucket "${GCS_BUCKET}" exists and is publicly readable.
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
