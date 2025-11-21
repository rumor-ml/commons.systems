/**
 * UploadJobControls - Component for controlling upload jobs
 */
export class UploadJobControls {
  constructor(apiBaseUrl, jobId, onAction) {
    this.apiBaseUrl = apiBaseUrl;
    this.jobId = jobId;
    this.onAction = onAction;
  }

  /**
   * Render the upload job controls
   * @param {HTMLElement} container - Container element to render into
   */
  render(container) {
    container.innerHTML = `
      <div class="upload-job-controls">
        <h4>Job Controls</h4>
        <div class="control-buttons">
          <button id="cancel-job-btn" class="btn-warning">Cancel Job</button>
          <button id="move-to-trash-btn" class="btn-danger">Move Uploaded/Skipped Files to Trash</button>
        </div>
        <div id="controls-status" class="status-message"></div>
      </div>
    `;

    const cancelBtn = container.querySelector('#cancel-job-btn');
    const trashBtn = container.querySelector('#move-to-trash-btn');
    const statusDiv = container.querySelector('#controls-status');

    cancelBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to cancel this job?')) {
        return;
      }

      statusDiv.textContent = 'Cancelling job...';
      statusDiv.className = 'status-message info';

      try {
        const response = await fetch(`${this.apiBaseUrl}/api/jobs/${this.jobId}/cancel`, {
          method: 'POST'
        });

        if (!response.ok) {
          throw new Error(`Failed to cancel job: ${response.statusText}`);
        }

        statusDiv.textContent = 'Job cancelled successfully';
        statusDiv.className = 'status-message success';

        if (this.onAction) {
          this.onAction('cancel');
        }
      } catch (error) {
        statusDiv.textContent = `Error: ${error.message}`;
        statusDiv.className = 'status-message error';
      }
    });

    trashBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to move uploaded and skipped files to trash? This cannot be undone.')) {
        return;
      }

      statusDiv.textContent = 'Moving files to trash...';
      statusDiv.className = 'status-message info';

      try {
        const response = await fetch(`${this.apiBaseUrl}/api/jobs/${this.jobId}/trash`, {
          method: 'POST'
        });

        if (!response.ok) {
          throw new Error(`Failed to move files to trash: ${response.statusText}`);
        }

        statusDiv.textContent = 'Files moved to trash successfully';
        statusDiv.className = 'status-message success';

        if (this.onAction) {
          this.onAction('trash');
        }
      } catch (error) {
        statusDiv.textContent = `Error: ${error.message}`;
        statusDiv.className = 'status-message error';
      }
    });
  }
}
