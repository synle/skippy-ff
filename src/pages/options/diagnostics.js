/** Options-only diagnostic export/clear controls. Reports stay local until the user copies them. */
const exportButton = document.getElementById("diagnostics-export");
const clearButton = document.getElementById("diagnostics-clear");
const output = document.getElementById("diagnostics-output");
const outputLabel = document.getElementById("diagnostics-output-label");
const status = document.getElementById("diagnostics-status");

/**
 * Request a worker-owned export or clear operation and render its actual result.
 * @param {"export"|"clear"} action Requested operation.
 * @returns {Promise<void>} Updates accessible status and JSON output; handles transport/storage failure without retries.
 */
async function requestDiagnostics(action) {
  exportButton.disabled = true;
  clearButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "SKIPPY_DIAGNOSTICS", action });
    if (!response?.ok) {
      status.textContent =
        "Diagnostics unavailable. Reload the extension and try again; evidence may be incomplete.";
      return;
    }
    output.value = action === "export" ? JSON.stringify(response.report, null, 2) : "";
    outputLabel.hidden = action !== "export";
    status.textContent =
      action === "export"
        ? "Copy the JSON below. Native crash cause remains unknown; review before sharing."
        : "Local diagnostics cleared. Future events may be recorded; settings are unchanged.";
  } catch {
    status.textContent = "Could not reach Skippy diagnostics. Reload the extension and try again.";
  } finally {
    exportButton.disabled = false;
    clearButton.disabled = false;
  }
}

exportButton.addEventListener("click", () => {
  void requestDiagnostics("export");
});
clearButton.addEventListener("click", () => {
  void requestDiagnostics("clear");
});
