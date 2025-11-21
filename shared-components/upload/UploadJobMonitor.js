/**
 * UploadJobMonitor - Component for monitoring upload job progress
 */
export class UploadJobMonitor {
  constructor(apiBaseUrl, jobId) {
    this.apiBaseUrl = apiBaseUrl;
    this.jobId = jobId;
    this.job = null;
    this.files = [];
    this.refreshInterval = null;
  }

  /**
   * Render the upload job monitor
   * @param {HTMLElement} container - Container element to render into
   */
  render(container) {
    this.container = container;
    this.updateUI();
    this.startPolling();
  }

  /**
   * Update the UI with current job data
   */
  updateUI() {
    if (!this.container) return;

    const jobInfo = this.job ? `
      <div class="job-info">
        <h3>${this.job.name}</h3>
        <p><strong>Status:</strong> <span class="status-badge ${this.job.status}">${this.job.status}</span></p>
        <p><strong>Base Path:</strong> ${this.job.basePath}</p>
        <p><strong>GCS Bucket:</strong> ${this.job.gcsBucket}/${this.job.gcsBasePath}</p>

        <div class="job-stats">
          <div class="stat">
            <span class="stat-label">Total Files:</span>
            <span class="stat-value">${this.job.totalFiles}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Processed:</span>
            <span class="stat-value">${this.job.processedFiles}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Uploaded:</span>
            <span class="stat-value success">${this.job.uploadedFiles}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Skipped:</span>
            <span class="stat-value warning">${this.job.skippedFiles}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Failed:</span>
            <span class="stat-value error">${this.job.failedFiles}</span>
          </div>
        </div>

        ${this.job.totalFiles > 0 ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${(this.job.processedFiles / this.job.totalFiles) * 100}%"></div>
          </div>
        ` : ''}
      </div>
    ` : '<p>Loading job information...</p>';

    const filesTable = this.files.length > 0 ? `
      <div class="files-table-container">
        <h4>Files</h4>
        <table class="files-table">
          <thead>
            <tr>
              <th>File Name</th>
              <th>Status</th>
              <th>Metadata</th>
              <th>Progress</th>
              <th>Logs</th>
            </tr>
          </thead>
          <tbody>
            ${this.files.map(file => `
              <tr class="file-row ${file.status}">
                <td>${file.fileName}</td>
                <td><span class="status-badge ${file.status}">${file.status}</span></td>
                <td>
                  ${file.metadata ? `
                    <div class="metadata">
                      ${file.metadata.artist ? `<div><strong>Artist:</strong> ${file.metadata.artist}</div>` : ''}
                      ${file.metadata.album ? `<div><strong>Album:</strong> ${file.metadata.album}</div>` : ''}
                      ${file.metadata.title ? `<div><strong>Title:</strong> ${file.metadata.title}</div>` : ''}
                    </div>
                  ` : '-'}
                </td>
                <td>
                  ${file.progress > 0 ? `
                    <div class="file-progress">
                      <div class="file-progress-bar">
                        <div class="file-progress-fill" style="width: ${file.progress}%"></div>
                      </div>
                      <span>${Math.round(file.progress)}%</span>
                    </div>
                  ` : '-'}
                </td>
                <td>
                  ${file.logs && file.logs.length > 0 ? `
                    <details>
                      <summary>${file.logs.length} log(s)</summary>
                      <ul class="file-logs">
                        ${file.logs.map(log => `<li>${log}</li>`).join('')}
                      </ul>
                    </details>
                  ` : '-'}
                  ${file.error ? `<div class="error-message">${file.error}</div>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p>No files discovered yet...</p>';

    this.container.innerHTML = `
      <div class="upload-job-monitor">
        ${jobInfo}
        ${filesTable}
      </div>
    `;
  }

  /**
   * Fetch job and files data from API
   */
  async fetchData() {
    try {
      const [jobResponse, filesResponse] = await Promise.all([
        fetch(`${this.apiBaseUrl}/api/jobs/${this.jobId}`),
        fetch(`${this.apiBaseUrl}/api/jobs/${this.jobId}/files`)
      ]);

      if (jobResponse.ok) {
        this.job = await jobResponse.json();
      }

      if (filesResponse.ok) {
        this.files = await filesResponse.json();
        // Sort files by discovered time
        this.files.sort((a, b) => new Date(a.discoveredAt) - new Date(b.discoveredAt));
      }

      this.updateUI();

      // Stop polling if job is completed, cancelled, or failed
      if (this.job && ['completed', 'cancelled', 'failed'].includes(this.job.status)) {
        this.stopPolling();
      }
    } catch (error) {
      console.error('Error fetching job data:', error);
    }
  }

  /**
   * Start polling for updates
   */
  startPolling(intervalMs = 2000) {
    this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), intervalMs);
  }

  /**
   * Stop polling for updates
   */
  stopPolling() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Cleanup when component is destroyed
   */
  destroy() {
    this.stopPolling();
  }
}
