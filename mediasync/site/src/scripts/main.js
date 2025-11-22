import { UploadJobStarter } from '@shared/upload/UploadJobStarter.js';
import { UploadJobMonitor } from '@shared/upload/UploadJobMonitor.js';
import { UploadJobControls } from '@shared/upload/UploadJobControls.js';

// Get API base URL from environment or use relative path
const API_BASE_URL = window.location.origin;

let currentMonitor = null;
let availableStrategies = [];

// Fetch available strategies
async function loadStrategies() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/strategies`);
    if (!response.ok) {
      throw new Error(`Failed to load strategies: ${response.statusText}`);
    }
    availableStrategies = await response.json();
    displayStrategies();
  } catch (error) {
    console.error('Error loading strategies:', error);
    document.getElementById('strategies-list').innerHTML =
      '<p style="color: white;">Failed to load media types. Please refresh the page.</p>';
  }
}

// Display available strategies
function displayStrategies() {
  const strategiesList = document.getElementById('strategies-list');
  strategiesList.innerHTML = availableStrategies.map(strategy => `
    <div class="strategy-card">
      <h3>${strategy.name.charAt(0).toUpperCase() + strategy.name.slice(1)}</h3>
      <p>${strategy.extensions.join(', ')}</p>
    </div>
  `).join('');
}

// Initialize the upload job starter
const jobStarter = new UploadJobStarter(API_BASE_URL, (job) => {
  showJobMonitor(job.id);
}, availableStrategies);

const starterContainer = document.getElementById('job-starter');
jobStarter.render(starterContainer);

// Function to show job monitor
function showJobMonitor(jobId) {
  const monitorSection = document.getElementById('job-monitor');
  const monitorContainer = document.getElementById('job-progress');
  const controlsContainer = document.getElementById('job-controls');

  monitorSection.style.display = 'block';

  // Clean up previous monitor if exists
  if (currentMonitor) {
    currentMonitor.destroy();
  }

  // Create new monitor
  currentMonitor = new UploadJobMonitor(API_BASE_URL, jobId);
  currentMonitor.render(monitorContainer);

  // Create controls
  const controls = new UploadJobControls(API_BASE_URL, jobId, (action) => {
    if (action === 'cancel' || action === 'trash') {
      // Refresh the monitor
      currentMonitor.fetchData();
    }
  });
  controls.render(controlsContainer);

  // Scroll to monitor
  monitorSection.scrollIntoView({ behavior: 'smooth' });
}

// Initialize on page load
async function init() {
  await loadStrategies();

  // Check if there's a job ID in the URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  if (jobId) {
    showJobMonitor(jobId);
  }
}

// Start initialization
init();

// Expose showJobMonitor for external use
window.showJobMonitor = showJobMonitor;
