/**
 * UploadJobStarter - Component for starting upload jobs
 */
export class UploadJobStarter {
  constructor(apiBaseUrl, onJobCreated, strategies = null) {
    this.apiBaseUrl = apiBaseUrl;
    this.onJobCreated = onJobCreated;
    this.strategies = strategies;
  }

  /**
   * Render the upload job starter form
   * @param {HTMLElement} container - Container element to render into
   */
  render(container) {
    const strategySelectHtml = this.strategies && this.strategies.length > 0 ? `
      <div class="form-group">
        <label for="strategy-name">Media Type:</label>
        <select id="strategy-name" name="strategyName" required>
          <option value="">Select media type...</option>
          ${this.strategies.map(s => `
            <option value="${s.name}">${s.name.charAt(0).toUpperCase() + s.name.slice(1)}</option>
          `).join('')}
        </select>
      </div>
    ` : '';

    container.innerHTML = `
      <div class="upload-job-starter">
        <form id="upload-job-form">
          ${strategySelectHtml}

          <div class="form-group">
            <label for="job-name">Job Name:</label>
            <input type="text" id="job-name" name="name" required placeholder="My Media Upload">
          </div>

          <div class="form-group">
            <label for="base-path">Local Path:</label>
            <input type="text" id="base-path" name="basePath" required placeholder="/path/to/media/files">
            <small>Path to the directory containing media files</small>
          </div>

          <div class="form-group">
            <label for="gcs-base-path">GCS Base Path:</label>
            <input type="text" id="gcs-base-path" name="gcsBasePath" value="media-uploads" placeholder="media-uploads">
            <small>Base path in GCS bucket (optional)</small>
          </div>

          <button type="submit" class="btn-primary">Start Upload Job</button>

          <div id="job-starter-status" class="status-message"></div>
        </form>
      </div>
    `;

    const form = container.querySelector('#upload-job-form');
    const statusDiv = container.querySelector('#job-starter-status');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      const data = {
        name: formData.get('name'),
        basePath: formData.get('basePath'),
        gcsBasePath: formData.get('gcsBasePath') || 'media-uploads'
      };

      // Include strategy name if strategies are available
      if (this.strategies && this.strategies.length > 0) {
        data.strategyName = formData.get('strategyName');
      }

      statusDiv.textContent = 'Creating job...';
      statusDiv.className = 'status-message info';

      try {
        const response = await fetch(`${this.apiBaseUrl}/api/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          throw new Error(`Failed to create job: ${response.statusText}`);
        }

        const job = await response.json();
        statusDiv.textContent = `Job created successfully! ID: ${job.id}`;
        statusDiv.className = 'status-message success';

        if (this.onJobCreated) {
          this.onJobCreated(job);
        }

        form.reset();
      } catch (error) {
        statusDiv.textContent = `Error: ${error.message}`;
        statusDiv.className = 'status-message error';
      }
    });
  }
}
