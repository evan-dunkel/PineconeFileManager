// Initialize WebSocket connection outside the DOMContentLoaded event
const socket = io();
let logsContainer = null;
let verboseMode = false;
let logBuffer = [];
const LAST_CLEAR_TIME_KEY = "lastLogClearTime";
const ADVANCED_MODE_KEY = "advancedMode";
const MAX_LOGS = 100;

// File upload handling
let currentFile = null;
let uploadModal = null;

function handleFileSelect(event) {
  const files = event.target.files || event.dataTransfer.files;
  if (!files.length) return;

  currentFile = files[0];
  const indexFilter = document.getElementById("index_filter");
  const selectedIndex = indexFilter.value;

  if (selectedIndex) {
    uploadFile(currentFile, selectedIndex);
  } else {
    // Show index selection modal
    uploadModal = new bootstrap.Modal(
      document.getElementById("indexSelectionModal")
    );
    uploadModal.show();
  }
}

function proceedWithUpload() {
  const selectedIndex = document.getElementById("upload_index_id").value;
  if (selectedIndex && currentFile) {
    uploadModal.hide();
    uploadFile(currentFile, selectedIndex);
  }
}

function uploadFile(file, indexId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("index_id", indexId);

  // Show progress bar and hide upload content
  const uploadContent = document.querySelector(".upload-content");
  const progressBar = document.querySelector(".upload-progress");
  const progressBarFill = document.querySelector(".progress-bar");
  const progressStatus = document.querySelector(".progress-status");

  uploadContent.style.display = "none";
  progressBar.style.display = "block";

  // Function to map progress based on phase
  const mapProgress = (progress, phase) => {
    if (phase === "uploading") {
      // Map upload progress to 0-80%
      const mappedProgress = progress * 0.8;
      progressStatus.textContent =
        mappedProgress >= 80 ? "Analyzing file..." : "Uploading file...";
      return mappedProgress;
    } else if (
      phase === "analyzing" ||
      phase === "processing" ||
      phase === "vectorizing"
    ) {
      // Map analysis progress to 80-100%
      return 80 + progress * 0.2;
    }
    return progress;
  };

  // Start polling for status
  const pollStatus = () => {
    fetch("/upload/status")
      .then((response) => response.json())
      .then((data) => {
        if (data.status === "processing") {
          const mappedProgress = mapProgress(
            data.progress,
            data.current_operation
          );
          progressBarFill.style.width = `${mappedProgress}%`;
          if (mappedProgress >= 80) {
            progressStatus.textContent = "Analyzing file...";
          }
          setTimeout(pollStatus, 1000); // Poll every second
        } else if (data.status === "complete") {
          progressStatus.textContent = "Upload complete!";
          progressBarFill.style.width = "100%";
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } else if (data.status === "error") {
          progressStatus.textContent = data.message;
          progressBar.classList.add("error");
          setTimeout(() => {
            progressBar.style.display = "none";
            progressBar.classList.remove("error");
            uploadContent.style.display = "flex";
          }, 3000);
        }
      })
      .catch((error) => {
        console.error("Error polling status:", error);
        progressBar.style.display = "none";
        uploadContent.style.display = "flex";
      });
  };

  // Track upload progress
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload", true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const uploadProgress = (e.loaded / e.total) * 100;
      const mappedProgress = mapProgress(uploadProgress, "uploading");
      progressBarFill.style.width = `${mappedProgress}%`;
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      const response = JSON.parse(xhr.responseText);
      if (response.error) {
        throw new Error(response.error);
      }
      // Start polling for processing status
      pollStatus();
    } else {
      throw new Error("Upload failed");
    }
  };

  xhr.onerror = () => {
    console.error("Upload error:", xhr.statusText);
    progressStatus.textContent = "Upload failed";
    progressBar.classList.add("error");
    setTimeout(() => {
      progressBar.style.display = "none";
      progressBar.classList.remove("error");
      uploadContent.style.display = "flex";
    }, 3000);
  };

  xhr.send(formData);
}

// Drag and drop handling
function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add("dragover");
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove("dragover");
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove("dragover");
  handleFileSelect(event);
}

// Add copy feedback element to the body
document.body.insertAdjacentHTML(
  "beforeend",
  '<div class="copied-feedback">Copied to clipboard!</div>'
);
const copyFeedback = document.querySelector(".copied-feedback");

// Function to toggle advanced mode UI
function toggleAdvancedMode(enabled) {
  // Save the state
  localStorage.setItem(ADVANCED_MODE_KEY, enabled);
}

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
    message.startsWith("Error") ||
    message.startsWith("No results found for query:") ||
    message.startsWith("Searching Pinecone index") ||
    (message.startsWith("Found") && message.includes("results for query:"))
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

  if (message.startsWith("Searching Pinecone index")) {
    const parts = message.match(/Searching Pinecone index '(.+)' for: (.+)/);
    if (parts) {
      const [_, indexName, query] = parts;
      return `🔎 Searching index <strong>${indexName}</strong> for: <strong>${query}</strong>`;
    }
  }

  if (message.startsWith("No results found for query:")) {
    const query = message.split(":")[1].trim();
    return `ℹ️ No results found for query: <strong>${query}</strong>`;
  }

  if (message.startsWith("Found") && message.includes("results for query:")) {
    const parts = message.match(/Found (\d+) results for query: (.+)/);
    if (parts) {
      const [_, count, query] = parts;
      return `✨ Found <strong>${count}</strong> results for query: <strong>${query}</strong>`;
    }
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

// Add index filtering functionality
function filterByIndex(indexId) {
  // Filter files
  const fileCards = document.querySelectorAll(".file-card");
  fileCards.forEach((card) => {
    const cardIndexId = card.getAttribute("data-index-id");
    if (!indexId || cardIndexId === indexId) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });

  // Filter logs
  const logEntries = document.querySelectorAll(".log-entry");
  logEntries.forEach((entry) => {
    const logIndexName = entry.getAttribute("data-index-name");
    const matchingIndex = indexId
      ? document.querySelector(`#index_filter option[value="${indexId}"]`)
      : null;
    const selectedIndexName = matchingIndex
      ? matchingIndex.textContent.trim().split(" ")[0]
      : null;

    if (
      !indexId ||
      !logIndexName ||
      (selectedIndexName && logIndexName.includes(selectedIndexName))
    ) {
      entry.style.display = "flex";
    } else {
      entry.style.display = "none";
    }
  });
}

// Initialize index filter listener
document.addEventListener("DOMContentLoaded", function () {
  const indexFilter = document.getElementById("index_filter");
  if (indexFilter) {
    indexFilter.addEventListener("change", (e) => {
      filterByIndex(e.target.value);
    });
  }
});

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
    const hasPreview =
      log.message.startsWith("Found relevant content in:") &&
      log.thumbnail_path;

    logEntry.className = `log-entry ${log.level}${
      isResponse ? " expandable" : ""
    }${hasPreview ? " has-preview" : ""}`;
    logEntry.innerHTML = `
      <span class="timestamp">${log.timestamp}</span>
      <span class="message">${formatLogMessage(log)}</span>
    `;

    // Add data attribute for index filtering if the log message contains index information
    const indexMatch = log.message.match(/index '([^']+)'/);
    if (indexMatch) {
      logEntry.setAttribute("data-index-name", indexMatch[1]);
    }

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
      const hasPreview =
        log.message.startsWith("Found relevant content in:") &&
        log.thumbnail_path;

      logEntry.className = `log-entry ${log.level}${
        isResponse ? " expandable" : ""
      }${hasPreview ? " has-preview" : ""}`;
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
  // Initialize logs container reference
  logsContainer = document.getElementById("api-logs");

  // Add verbose mode toggle handler
  const verboseToggle = document.getElementById("verboseLogging");
  if (verboseToggle) {
    verboseToggle.addEventListener("change", (e) => {
      verboseMode = e.target.checked;
      refreshLogs();
    });
  }

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

  // Initialize file upload handlers
  const uploadZone = document.querySelector(".upload-zone");
  const fileInput = document.getElementById("file-input");

  if (uploadZone) {
    uploadZone.addEventListener("dragover", handleDragOver);
    uploadZone.addEventListener("dragleave", handleDragLeave);
    uploadZone.addEventListener("drop", handleDrop);
  }

  if (fileInput) {
    fileInput.addEventListener("change", handleFileSelect);
  }
});
