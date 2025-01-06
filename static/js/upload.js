// Initialize WebSocket connection outside the DOMContentLoaded event
const socket = io();
let logsContainer = null;
let verboseMode = false;
let logBuffer = [];
const LAST_CLEAR_TIME_KEY = "lastLogClearTime";
const ACTIVE_TAB_KEY = "activeTab";
const ADVANCED_MODE_KEY = "advancedMode";
const MAX_LOGS = 100;

// Add copy feedback element to the body
document.body.insertAdjacentHTML(
  "beforeend",
  '<div class="copied-feedback">Copied to clipboard!</div>'
);
const copyFeedback = document.querySelector(".copied-feedback");

// Function to save active tab
function saveActiveTab(tabId) {
  localStorage.setItem(ACTIVE_TAB_KEY, tabId);
}

// Function to restore active tab
function restoreActiveTab() {
  const activeTab = localStorage.getItem(ACTIVE_TAB_KEY) || "upload-tab";
  const tabElement = document.querySelector(`#${activeTab}`);
  const contentId = tabElement?.getAttribute("data-bs-target")?.substring(1);

  if (tabElement && contentId) {
    const tab = new bootstrap.Tab(tabElement);
    tab.show();

    // Update content visibility
    document.querySelectorAll(".tab-pane").forEach((pane) => {
      pane.classList.remove("show", "active");
    });
    document.getElementById(contentId)?.classList.add("show", "active");
  }
}

function isHighlightedEvent(message) {
  return (
    message.startsWith("Extracted search terms:") ||
    message ===
      "No search terms identified - query does not require knowledge base search" ||
    message.startsWith("Found relevant content in:") ||
    message === "Generated response based on found content" ||
    message.startsWith("Error")
  );
}

function formatLogMessage(log) {
  const message = log.message;

  // Check for different types of messages and format accordingly
  if (message.startsWith("Extracted search terms:")) {
    return `🔍 Search terms identified: <strong>${message
      .split(":")[1]
      .trim()}</strong>`;
  }

  if (
    message ===
    "No search terms identified - query does not require knowledge base search"
  ) {
    return `ℹ️ No knowledge base search needed for this query`;
  }

  if (message.startsWith("Found relevant content in:")) {
    const filename = message.split(":")[1].trim();
    const thumbnailHtml = log.thumbnail_path
      ? `<div class="content-preview">
          <img src="/static/${log.thumbnail_path}" alt="Content preview" class="content-thumbnail">
         </div>`
      : "";
    return `
      <div class="d-flex align-items-center gap-3">
        ${thumbnailHtml}
        <div>📄 Found relevant content in <strong>${filename}</strong></div>
      </div>
    `;
  }

  if (message === "Generated response based on found content") {
    return `
      <div class="d-flex align-items-center justify-content-between">
        <span>✨ Response generated based on found content</span>
        <button class="btn btn-sm btn-link p-0 toggle-response" aria-expanded="false">
          <i data-feather="chevron-down"></i>
        </button>
      </div>
      <div class="response-content" style="display: none;">
        <div class="mt-2 p-2 bg-light rounded">
          ${log.response || "No response content available"}
        </div>
      </div>
    `;
  }

  if (message.startsWith("Error")) {
    return `❌ ${message}`;
  }

  return message;
}

function toggleResponse(logEntry) {
  const toggleBtn = logEntry.querySelector(".toggle-response");
  const responseContent = logEntry.querySelector(".response-content");
  const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";

  responseContent.style.display = isExpanded ? "none" : "block";
  toggleBtn.setAttribute("aria-expanded", !isExpanded);

  // Rotate chevron
  const icon = toggleBtn.querySelector("svg");
  icon.style.transform = isExpanded ? "rotate(0deg)" : "rotate(180deg)";
}

function showCopyFeedback() {
  copyFeedback.classList.add("show");
  setTimeout(() => copyFeedback.classList.remove("show"), 2000);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showCopyFeedback();
  } catch (err) {
    console.error("Failed to copy text: ", err);
  }
}

function getCleanText(element) {
  // Create a clone of the element to manipulate
  const clone = element.cloneNode(true);

  // Remove any buttons or interactive elements
  const removeElements = clone.querySelectorAll(
    ".toggle-response, .response-content"
  );
  removeElements.forEach((el) => el.remove());

  // Get the text content and clean it up
  return clone.textContent.trim();
}

function addLogEntry(log) {
  if (!logsContainer) {
    logsContainer = document.getElementById("api-logs");
    if (!logsContainer) return;
  }

  // Add to buffer
  logBuffer.push(log);

  // Keep only the last MAX_LOGS entries
  if (logBuffer.length > MAX_LOGS) {
    logBuffer = logBuffer.slice(-MAX_LOGS);
  }

  if (verboseMode || isHighlightedEvent(log.message)) {
    const placeholder = logsContainer.querySelector(".text-muted");
    if (placeholder) {
      logsContainer.innerHTML = "";
    }

    const logEntry = document.createElement("div");
    const isResponse =
      log.message === "Generated response based on found content";
    logEntry.className = `log-entry ${log.level}${
      isResponse ? " expandable" : ""
    }`;
    logEntry.innerHTML = `
      <span class="timestamp">${log.timestamp}</span>
      <span class="message">${formatLogMessage(log)}</span>
    `;

    // Add click handlers
    if (isResponse) {
      // For response entries, only make the response content clickable
      logEntry.addEventListener("click", (e) => {
        const responseContent = logEntry.querySelector(".response-content");
        if (e.target.closest(".response-content")) {
          // If clicking the response content, copy it
          copyToClipboard(log.response || "No response content available");
          e.stopPropagation();
        } else if (!e.target.closest(".response-content")) {
          // If clicking elsewhere, toggle the response
          toggleResponse(logEntry);
        }
      });
    } else {
      // For regular entries, handle clicks based on target
      logEntry.addEventListener("click", (e) => {
        const thumbnail = e.target.closest(".content-thumbnail");
        if (thumbnail) {
          // If clicking a thumbnail, open the file in a new tab using file ID
          if (log.file_id) {
            window.open(`/file/${log.file_id}`, "_blank");
            e.stopPropagation();
          }
        } else {
          // Otherwise, copy the log text
          copyToClipboard(getCleanText(logEntry));
        }
      });
    }

    logsContainer.appendChild(logEntry);
    feather.replace();
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
}

function refreshLogs() {
  if (!logsContainer) return;

  logsContainer.innerHTML =
    '<div class="text-muted text-center">Waiting for API activity...</div>';

  const logsToShow = logBuffer.filter(
    (log) => verboseMode || isHighlightedEvent(log.message)
  );

  if (logsToShow.length > 0) {
    logsContainer.innerHTML = "";
    logsToShow.forEach((log) => {
      const logEntry = document.createElement("div");
      const isResponse =
        log.message === "Generated response based on found content";
      logEntry.className = `log-entry ${log.level}${
        isResponse ? " expandable" : ""
      }`;
      logEntry.innerHTML = `
        <span class="timestamp">${log.timestamp}</span>
        <span class="message">${formatLogMessage(log)}</span>
      `;

      if (isResponse) {
        logEntry.addEventListener("click", (e) => {
          const responseContent = logEntry.querySelector(".response-content");
          if (e.target.closest(".response-content")) {
            copyToClipboard(log.response || "No response content available");
            e.stopPropagation();
          } else if (!e.target.closest(".response-content")) {
            toggleResponse(logEntry);
          }
        });
      } else {
        logEntry.addEventListener("click", (e) => {
          const thumbnail = e.target.closest(".content-thumbnail");
          if (thumbnail) {
            // If clicking a thumbnail, open the file in a new tab using file ID
            if (log.file_id) {
              window.open(`/file/${log.file_id}`, "_blank");
              e.stopPropagation();
            }
          } else {
            // Otherwise, copy the log text
            copyToClipboard(getCleanText(logEntry));
          }
        });
      }

      logsContainer.appendChild(logEntry);
    });

    feather.replace();
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
}

function clearLogs() {
  if (!logsContainer) {
    logsContainer = document.getElementById("api-logs");
    if (!logsContainer) return;
  }
  logBuffer = [];
  localStorage.setItem(LAST_CLEAR_TIME_KEY, new Date().toISOString());
  logsContainer.innerHTML =
    '<div class="text-muted text-center">Waiting for API activity...</div>';
}

// Function to toggle advanced mode UI
function toggleAdvancedMode(enabled) {
  const tabsSection = document.getElementById("tabsSection");
  const logsContent = document.getElementById("logs-content");
  const uploadContent = document.getElementById("upload-content");

  if (enabled) {
    tabsSection.style.display = "block";
    // Restore tab state
    restoreActiveTab();
  } else {
    tabsSection.style.display = "none";
    // Always show upload content in basic mode
    uploadContent.classList.add("show", "active");
    logsContent.classList.remove("show", "active");
    // Reset stored active tab to upload-tab
    localStorage.setItem(ACTIVE_TAB_KEY, "upload-tab");
  }

  // Save the state
  localStorage.setItem(ADVANCED_MODE_KEY, enabled);
}

// Socket.IO event handlers
socket.on("connect", () => {
  console.log("WebSocket connected");
  logsContainer = document.getElementById("api-logs");

  // Load initial logs on first connect
  fetch("/api/logs")
    .then((res) => res.json())
    .then((logs) => {
      const lastClearTime = localStorage.getItem(LAST_CLEAR_TIME_KEY);

      // If logs exist and were not explicitly cleared, show them
      if (logs.length > 0) {
        if (lastClearTime) {
          // Only filter out logs before the last clear time
          logBuffer = logs.filter(
            (log) => new Date(log.timestamp) > new Date(lastClearTime)
          );
        } else {
          // If no clear time exists, show all logs (but respect MAX_LOGS limit)
          logBuffer = logs.slice(-MAX_LOGS);
        }

        // Only refresh the display if we have logs to show
        if (logBuffer.length > 0) {
          refreshLogs();
        }
      }
    })
    .catch((error) => console.error("Error loading initial logs:", error));
});

socket.on("new_log", (log) => {
  const lastClearTime = localStorage.getItem(LAST_CLEAR_TIME_KEY);
  // Only add new logs if they're after the last clear time
  if (!lastClearTime || new Date(log.timestamp) > new Date(lastClearTime)) {
    addLogEntry(log);
  }
});

// DOM event listeners
document.addEventListener("DOMContentLoaded", function () {
  const uploadZone = document.querySelector(".upload-zone");
  const uploadContent = document.querySelector(".upload-content");
  const fileInput = document.querySelector("#file-input");

  // Initialize logs container reference
  logsContainer = document.getElementById("api-logs");

  // Add progress elements
  const progressElement = document.createElement("div");
  progressElement.className = "upload-progress";
  progressElement.innerHTML = `
    <div class="progress-status">Preparing upload...</div>
    <div class="progress-bar-container">
      <div class="progress-bar"></div>
    </div>
  `;
  uploadContent.appendChild(progressElement);

  const progressBar = progressElement.querySelector(".progress-bar");
  const progressStatus = progressElement.querySelector(".progress-status");

  // Hide progress element initially
  progressElement.style.display = "none";

  // Function to simulate an upload process
  window.simulateUpload = function () {
    toggleUploadInterface(true);
    updateProgress(0, "Starting upload simulation...");

    let currentProgress = 0;
    const stages = [
      { progress: 30, message: "Uploading file...", duration: 2000 },
      { progress: 50, message: "Processing file...", duration: 1500 },
      { progress: 70, message: "Analyzing content...", duration: 1500 },
      { progress: 100, message: "Complete!", duration: 1000 },
    ];

    let currentStage = 0;

    function runStage() {
      if (currentStage >= stages.length) {
        setTimeout(() => {
          toggleUploadInterface(false);
        }, 1000);
        return;
      }

      const stage = stages[currentStage];
      const startProgress = currentProgress;
      const progressDiff = stage.progress - startProgress;
      const startTime = Date.now();

      function updateStage() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / stage.duration, 1);
        currentProgress = startProgress + progressDiff * progress;

        updateProgress(currentProgress, stage.message);

        if (progress < 1) {
          requestAnimationFrame(updateStage);
        } else {
          currentStage++;
          setTimeout(runStage, 200);
        }
      }

      requestAnimationFrame(updateStage);
    }

    runStage();
  };

  // Function to toggle upload interface elements
  function toggleUploadInterface(showProgress) {
    const uploadElements = uploadContent.querySelectorAll(
      "i, h4, p, input, button"
    );
    uploadElements.forEach((el) => {
      el.style.display = showProgress ? "none" : "";
    });
    progressElement.style.display = showProgress ? "block" : "none";
  }

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    uploadZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ["dragenter", "dragover"].forEach((eventName) => {
    uploadZone.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    uploadZone.addEventListener(eventName, unhighlight, false);
  });

  function highlight() {
    uploadZone.classList.add("dragover");
  }

  function unhighlight() {
    uploadZone.classList.remove("dragover");
  }

  uploadZone.addEventListener("drop", handleDrop, false);

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
  }

  fileInput.addEventListener("change", function () {
    handleFiles(this.files);
  });

  function updateProgress(percent, status) {
    // Smoothly animate the progress bar
    const currentWidth = parseFloat(progressBar.style.width) || 0;
    const targetWidth = percent;

    // Animate from current to target width
    const startTime = performance.now();
    const duration = 500; // Animation duration in milliseconds

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const currentPercent =
        currentWidth + (targetWidth - currentWidth) * progress;
      progressBar.style.width = `${currentPercent}%`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
    progressStatus.textContent = status;
  }

  function handleFiles(files) {
    if (!files.length) return;

    const formData = new FormData();
    formData.append("file", files[0]);

    // Show progress element and hide upload interface
    toggleUploadInterface(true);
    updateProgress(0, "Starting upload...");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload", true);

    // Track upload progress
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        const uploadPercent = (e.loaded / e.total) * 100;
        updateProgress(uploadPercent * 0.2, "Uploading file..."); // Scale to 0-20% range
      }
    };

    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          const response = JSON.parse(xhr.responseText);

          // Start polling for status updates
          const pollStatus = () => {
            fetch("/upload/status")
              .then((res) => res.json())
              .then((data) => {
                if (data.status === "error") {
                  updateProgress(0, data.message || "Upload failed");
                  setTimeout(() => {
                    toggleUploadInterface(false);
                  }, 3000);
                } else if (data.status === "complete") {
                  updateProgress(100, "Complete!");
                  setTimeout(() => window.location.reload(), 1000);
                } else if (data.status === "idle") {
                  // Status is too old, refresh the page
                  window.location.reload();
                } else {
                  // Update progress based on current operation
                  const progress = data.progress || 0;
                  const message = data.message || "Processing...";

                  // Only update if there's a change in progress or message
                  const currentMessage = progressStatus.textContent;
                  const currentProgress =
                    parseFloat(progressBar.style.width) || 0;

                  if (
                    message !== currentMessage ||
                    Math.abs(progress - currentProgress) > 0.1
                  ) {
                    console.log(
                      `Status Update - Progress: ${progress}%, Message: ${message}`
                    ); // Debug log
                    updateProgress(progress, message);
                  }

                  // Poll more frequently during active processing
                  setTimeout(pollStatus, 100); // Poll every 100ms
                }
              })
              .catch((error) => {
                console.error("Status check error:", error); // Debug log
                updateProgress(0, "Error checking status");
                setTimeout(() => {
                  toggleUploadInterface(false);
                }, 3000);
              });
          };

          // Start polling immediately
          pollStatus();
        } catch (e) {
          updateProgress(0, "Error processing response");
          setTimeout(() => {
            toggleUploadInterface(false);
          }, 3000);
        }
      } else {
        try {
          const response = JSON.parse(xhr.responseText);
          updateProgress(0, response.error || "Upload failed");
          setTimeout(() => {
            toggleUploadInterface(false);
          }, 3000);
        } catch (e) {
          updateProgress(0, "Upload failed");
          setTimeout(() => {
            toggleUploadInterface(false);
          }, 3000);
        }
      }
    };

    xhr.onerror = function () {
      updateProgress(0, "Upload failed");
      setTimeout(() => {
        toggleUploadInterface(false);
      }, 3000);
    };

    xhr.send(formData);
  }

  // File deletion functionality
  document.querySelectorAll('form[action^="/delete/"]').forEach((form) => {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      if (confirm("Are you sure you want to delete this file?")) {
        const fileCard = this.closest(".file-card");
        const deleteStatus = document.createElement("div");
        deleteStatus.className = "alert alert-info d-flex align-items-center";
        deleteStatus.innerHTML = `
          <i data-feather="trash-2" class="me-2"></i>
          <span>Deleting file and associated data...</span>
        `;

        if (fileCard) {
          fileCard.appendChild(deleteStatus);
          feather.replace();
          fileCard.style.transition = "opacity 0.5s ease";
          this.submit();
        }
      }
    });
  });

  // Make clearLogs function available globally
  window.clearLogs = clearLogs;

  // Add verbose mode toggle handler
  const verboseToggle = document.getElementById("verboseLogging");
  if (verboseToggle) {
    verboseToggle.addEventListener("change", (e) => {
      verboseMode = e.target.checked;
      refreshLogs();
    });
  }

  // Add tab change listener
  document.querySelectorAll('button[data-bs-toggle="tab"]').forEach((tabEl) => {
    tabEl.addEventListener("shown.bs.tab", (event) => {
      saveActiveTab(event.target.id);
    });
  });

  // Restore active tab
  restoreActiveTab();

  // Initialize advanced mode toggle
  const advancedModeToggle = document.getElementById("advancedMode");
  if (advancedModeToggle) {
    // Restore previous state
    const isAdvancedMode = localStorage.getItem(ADVANCED_MODE_KEY) === "true";
    advancedModeToggle.checked = isAdvancedMode;
    toggleAdvancedMode(isAdvancedMode);

    // Add change listener
    advancedModeToggle.addEventListener("change", (e) => {
      toggleAdvancedMode(e.target.checked);
    });
  }
});
