/**
 * Audio Browser - Main Application
 * Fetches audio metadata from Firestore and audio files from GCS
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { firebaseConfig } from '../firebase-config.js';
import { initializeAuth } from './auth-init.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Configuration
const AUDIO_COLLECTION = 'audio'; // Firestore collection name
const AUDIO_PREFIX = 'audio/'; // GCS prefix for audio files

// State
let allAudioFiles = [];
let currentAudio = null;

// DOM Elements
const audioPlayer = document.getElementById('audioPlayer');
const audioInfo = document.getElementById('audioInfo');
const fileList = document.getElementById('fileList');
const loadingIndicator = document.getElementById('loadingIndicator');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const totalCount = document.getElementById('totalCount');

/**
 * Formats bytes to human-readable size
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Formats timestamp to readable format
 */
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown date';

  // Handle Firestore Timestamp
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Fetches audio metadata from Firestore and signed URLs from GCS
 */
async function fetchAudioFiles() {
  try {
    // Query Firestore for audio metadata
    const audioQuery = query(collection(db, AUDIO_COLLECTION), orderBy('title', 'asc'));

    const querySnapshot = await getDocs(audioQuery);

    // Process each document
    const audioPromises = querySnapshot.docs.map(async (doc) => {
      const data = doc.data();

      try {
        // Get signed URL from Firebase Storage
        const storagePath = data.storagePath || `${AUDIO_PREFIX}${data.filename || doc.id}`;
        const audioRef = ref(storage, storagePath);
        const downloadUrl = await getDownloadURL(audioRef);

        return {
          id: doc.id,
          title: data.title || 'Untitled',
          artist: data.artist || 'Unknown Artist',
          album: data.album || '',
          duration: data.duration || 0,
          size: data.size || 0,
          filename: data.filename || doc.id,
          storagePath: storagePath,
          uploadedAt: data.uploadedAt || data.createdAt,
          genre: data.genre || '',
          year: data.year || '',
          metadata: data, // Store full metadata
          downloadUrl: downloadUrl, // Signed URL from Firebase Storage
        };
      } catch (error) {
        console.error(`Error fetching download URL for ${doc.id}:`, error);
        return null;
      }
    });

    // Wait for all promises to resolve
    const audioFiles = (await Promise.all(audioPromises)).filter((audio) => audio !== null);

    return audioFiles;
  } catch (error) {
    throw new Error(`Error fetching audio files: ${error.message}`);
  }
}

/**
 * Renders the file list
 */
function renderFileList(audioFiles) {
  fileList.innerHTML = '';

  if (audioFiles.length === 0) {
    fileList.innerHTML = `
      <div class="empty-state">
        <p>No audio files found</p>
      </div>
    `;
    return;
  }

  audioFiles.forEach((audio) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    if (currentAudio && currentAudio.id === audio.id) {
      item.classList.add('file-item--active');
    }

    // Build metadata string
    const metaParts = [];
    if (audio.artist) metaParts.push(escapeHtml(audio.artist));
    if (audio.duration) metaParts.push(formatDuration(audio.duration));
    if (audio.size) metaParts.push(formatBytes(audio.size));

    item.innerHTML = `
      <div class="file-item__name">${escapeHtml(audio.title)}</div>
      <div class="file-item__meta">
        ${metaParts.join(' • ')}
      </div>
    `;

    item.addEventListener('click', () => playAudio(audio));
    fileList.appendChild(item);
  });
}

/**
 * Plays an audio file
 */
function playAudio(audio) {
  currentAudio = audio;

  // Update audio player with signed URL
  audioPlayer.src = audio.downloadUrl;
  audioPlayer.load();

  // Build detailed info
  const infoParts = [];
  if (audio.artist) infoParts.push(`Artist: ${escapeHtml(audio.artist)}`);
  if (audio.album) infoParts.push(`Album: ${escapeHtml(audio.album)}`);
  if (audio.genre) infoParts.push(`Genre: ${escapeHtml(audio.genre)}`);
  if (audio.year) infoParts.push(`Year: ${audio.year}`);
  if (audio.size) infoParts.push(`Size: ${formatBytes(audio.size)}`);
  if (audio.duration) infoParts.push(`Duration: ${formatDuration(audio.duration)}`);
  if (audio.uploadedAt) infoParts.push(`Uploaded: ${formatDate(audio.uploadedAt)}`);

  // Update audio info
  audioInfo.innerHTML = `
    <div class="audio-info__title">${escapeHtml(audio.title)}</div>
    <div class="audio-info__details">
      ${infoParts.join(' | ')}
    </div>
  `;

  // Re-render file list to update active state
  const searchTerm = searchInput.value.toLowerCase().trim();
  const filtered = searchTerm
    ? allAudioFiles.filter((a) => matchesSearch(a, searchTerm))
    : allAudioFiles;
  renderFileList(filtered);
}

/**
 * Checks if audio matches search term
 */
function matchesSearch(audio, searchTerm) {
  return (
    audio.title.toLowerCase().includes(searchTerm) ||
    audio.artist.toLowerCase().includes(searchTerm) ||
    audio.album.toLowerCase().includes(searchTerm) ||
    audio.filename.toLowerCase().includes(searchTerm) ||
    (audio.genre && audio.genre.toLowerCase().includes(searchTerm))
  );
}

/**
 * Filters audio files based on search term
 */
function filterAudioFiles() {
  const searchTerm = searchInput.value.toLowerCase().trim();
  const filtered = searchTerm
    ? allAudioFiles.filter((a) => matchesSearch(a, searchTerm))
    : allAudioFiles;

  renderFileList(filtered);
  totalCount.textContent = filtered.length;
}

/**
 * Loads audio files from Firestore and GCS
 */
async function loadAudioFiles() {
  try {
    // Show loading state
    loadingIndicator.classList.remove('hidden');
    fileList.innerHTML = '';
    refreshBtn.disabled = true;

    // Fetch audio files
    allAudioFiles = await fetchAudioFiles();

    // Update UI
    totalCount.textContent = allAudioFiles.length;
    renderFileList(allAudioFiles);

    // Hide loading
    loadingIndicator.classList.add('hidden');
    refreshBtn.disabled = false;
  } catch (error) {
    loadingIndicator.classList.add('hidden');
    refreshBtn.disabled = false;

    // Show error
    fileList.innerHTML = `
      <div class="error">
        <div class="error__title">Failed to load audio files</div>
        <p>${escapeHtml(error.message)}</p>
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">
          Make sure Firestore and Firebase Storage are configured correctly.
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
      if (audioPlayer.paused) {
        audioPlayer.play();
      } else {
        audioPlayer.pause();
      }
    }

    // Arrow keys: skip forward/backward
    if (e.code === 'ArrowLeft' && !audioPlayer.paused) {
      audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
    }
    if (e.code === 'ArrowRight' && !audioPlayer.paused) {
      audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
    }

    // Up/Down: navigate audio list
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      if (document.activeElement !== searchInput) {
        e.preventDefault();
        navigateAudioList(e.code === 'ArrowUp' ? -1 : 1);
      }
    }
  });
}

/**
 * Navigate audio list with keyboard
 */
function navigateAudioList(direction) {
  if (allAudioFiles.length === 0) return;

  const currentIndex = currentAudio ? allAudioFiles.findIndex((a) => a.id === currentAudio.id) : -1;

  let nextIndex = currentIndex + direction;

  // Wrap around
  if (nextIndex < 0) nextIndex = allAudioFiles.length - 1;
  if (nextIndex >= allAudioFiles.length) nextIndex = 0;

  playAudio(allAudioFiles[nextIndex]);
}

/**
 * Initialize the application
 */
async function init() {
  // Initialize authentication
  initializeAuth();

  // Setup event listeners
  refreshBtn.addEventListener('click', loadAudioFiles);
  searchInput.addEventListener('input', filterAudioFiles);

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Initial load
  await loadAudioFiles();
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
