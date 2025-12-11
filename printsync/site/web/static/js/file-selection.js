// Toggle all extracted file checkboxes
function toggleAllExtracted() {
  const selectAll = document.getElementById('select-all-extracted');
  const checkboxes = document.querySelectorAll('input[name="file-ids"]');
  checkboxes.forEach((cb) => (cb.checked = selectAll.checked));
  updateButtonState();
}

// Update "Select All" state based on individual checkboxes
function updateSelectAllState() {
  const selectAll = document.getElementById('select-all-extracted');
  if (!selectAll) return;

  const checkboxes = document.querySelectorAll('input[name="file-ids"]');
  const checkedCount = document.querySelectorAll('input[name="file-ids"]:checked').length;
  const totalCount = checkboxes.length;

  if (totalCount === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  } else if (checkedCount === totalCount) {
    selectAll.checked = true;
    selectAll.indeterminate = false;
  } else if (checkedCount > 0) {
    selectAll.checked = false;
    selectAll.indeterminate = true;
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }

  updateButtonState();
}

// Update button state based on selection
function updateButtonState() {
  const checkedCount = document.querySelectorAll('input[name="file-ids"]:checked').length;
  const uploadBtn = document.getElementById('upload-selected-btn');
  const countSpan = document.getElementById('selected-count');
  const selectAllContainer = document.getElementById('select-all-container');
  const checkboxes = document.querySelectorAll('input[name="file-ids"]');

  if (uploadBtn) {
    uploadBtn.disabled = checkedCount === 0;
  }

  if (countSpan) {
    countSpan.textContent = checkedCount;
  }

  // Show "Select All" container only if there are checkboxes
  if (selectAllContainer) {
    if (checkboxes.length > 0) {
      selectAllContainer.classList.remove('hidden');
      selectAllContainer.classList.add('flex');
    } else {
      selectAllContainer.classList.add('hidden');
      selectAllContainer.classList.remove('flex');
    }
  }
}

// Initialize on page load and after HTMX swaps
document.addEventListener('DOMContentLoaded', function () {
  updateSelectAllState();
  // Add HTMX listener after DOM is ready
  document.body.addEventListener('htmx:afterSwap', updateSelectAllState);
});
