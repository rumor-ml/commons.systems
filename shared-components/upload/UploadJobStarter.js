/**
 * UploadJobStarter - Component for starting upload jobs
 */
export class UploadJobStarter {
  constructor(apiBaseUrl, onJobCreated) {
    this.apiBaseUrl = apiBaseUrl;
    this.onJobCreated = onJobCreated;
  }

  /**
   * Render the upload job starter form
   * @param {HTMLElement} container - Container element to render into
   */
  render(container) {
    container.innerHTML = `
      <div class="upload-job-starter">
        <h2>Start Upload Job</h2>
        <form id="upload-job-form">
          <div class="form-group">
            <label for="job-name">Job Name:</label>
            <input type="text" id="job-name" name="name" required placeholder="My Audio Upload">
          </div>

          <div class="form-group">
            <label for="base-path">Local Path:</label>
            <input type="text" id="base-path" name="basePath" required placeholder="/path/to/audio/files">
            <small>Path to the directory containing audio files</small>
          </div>

          <div class="form-group">
            <label for="gcs-base-path">GCS Base Path:</label>
            <input type="text" id="gcs-base-path" name="gcsBasePath" value="audio-uploads" placeholder="audio-uploads">
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
        gcsBasePath: formData.get('gcsBasePath') || 'audio-uploads'
      };

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
