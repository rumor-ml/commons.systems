import { UploadJobStarter } from '../../../../shared-components/upload/UploadJobStarter.js';
import { UploadJobMonitor } from '../../../../shared-components/upload/UploadJobMonitor.js';
import { UploadJobControls } from '../../../../shared-components/upload/UploadJobControls.js';

// Get API base URL from environment or use relative path
const API_BASE_URL = window.location.origin;

let currentMonitor = null;

// Initialize the upload job starter
const jobStarter = new UploadJobStarter(API_BASE_URL, (job) => {
  console.log('Job created:', job);
  showJobMonitor(job.id);
});

const starterContainer = document.getElementById('job-starter-section');
jobStarter.render(starterContainer);

// Function to show job monitor
function showJobMonitor(jobId) {
  const monitorSection = document.getElementById('job-monitor-section');
  const monitorContainer = document.getElementById('job-monitor-container');
  const controlsContainer = document.getElementById('job-controls-container');

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
    console.log('Control action:', action);
    if (action === 'cancel' || action === 'trash') {
      // Refresh the monitor
      currentMonitor.fetchData();
    }
  });
  controls.render(controlsContainer);

  // Scroll to monitor
  monitorSection.scrollIntoView({ behavior: 'smooth' });
}

// Check if there's a job ID in the URL query params
const urlParams = new URLSearchParams(window.location.search);
const jobId = urlParams.get('jobId');

if (jobId) {
  showJobMonitor(jobId);
}

// Expose showJobMonitor for external use
window.showJobMonitor = showJobMonitor;
