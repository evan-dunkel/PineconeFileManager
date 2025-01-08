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
    message.startsWith("Search terms identified:") ||
    message.startsWith("No search terms found") ||
    message.startsWith("Found relevant content in") ||
    message.startsWith("Generated response:") ||
    message.startsWith("Error")
  );
}

function formatLogMessage(log) {
  const message = log.message;

  // Check for different types of messages and format accordingly
  if (message.startsWith("Search terms identified:")) {
    const terms = message.substring("Search terms identified:".length).trim();
    return `🔍 Search terms identified: <span class="highlight">${terms}</span>`;
  }

  if (message.startsWith("No search terms found")) {
    return `ℹ️ ${message}`;
  }

  if (message.startsWith("Found relevant content in")) {
    // Extract filename from message
    const filename = message.substring("Found relevant content in ".length);

    // Construct thumbnail path
    const thumbnailPath = `/static/thumbnails/pdf_thumb_${filename}.jpg`;

    // Get content from matches if available
    const content = log.matches
      ? log.matches
          .map((match) => match.metadata.text_content)
          .join("\n\n---\n\n")
      : log.contexts
      ? log.contexts.map((ctx) => ctx.text).join("\n\n")
      : log.text_content || "No content available";

    // Split into main content and expandable section
    return `
      <div class="log-main-content d-flex flex-column w-100">
        <div class="d-flex align-items-center justify-content-between">
          <div class="d-flex align-items-center gap-3">
            <div class="content-preview">
              <img src="${thumbnailPath}" alt="${filename}" class="content-thumbnail">
            </div>
            <div>📄 Found relevant content in <span class="highlight">${filename}</span></div>
          </div>
          <button class="btn btn-sm btn-link p-0 toggle-response" aria-expanded="false">
            <i data-feather="chevron-down"></i>
          </button>
        </div>
        <div class="expandable-content" style="display: none;">
          <div class="mt-2 p-3 bg-light rounded">
            <pre class="mb-0" style="white-space: pre-wrap;">${content}</pre>
          </div>
        </div>
      </div>
    `;
  }

  if (message.startsWith("Generated response:")) {
    // Split into main content and expandable section
    const responseContent = message
      .substring("Generated response:".length)
      .trim();
    return `
      <div class="log-main-content d-flex flex-column w-100">
        <div class="d-flex align-items-center justify-content-between">
          <div>✨ Generated response</div>
          <button class="btn btn-sm btn-link p-0 toggle-response" aria-expanded="false">
            <i data-feather="chevron-down"></i>
          </button>
        </div>
        <div class="expandable-content" style="display: none;">
          <div class="mt-2 p-3 bg-light rounded">
            <pre class="mb-0" style="white-space: pre-wrap;">${responseContent}</pre>
          </div>
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
  const expandableContent = logEntry.querySelector(".expandable-content");
  const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";

  expandableContent.style.display = isExpanded ? "none" : "block";
  toggleBtn.setAttribute("aria-expanded", !isExpanded);

  // Rotate chevron
  const icon = toggleBtn.querySelector("svg");
  icon.style.transform = isExpanded ? "rotate(0deg)" : "rotate(180deg)";

  // Smooth transition for height
  if (!isExpanded) {
    expandableContent.style.maxHeight = expandableContent.scrollHeight + "px";
  } else {
    expandableContent.style.maxHeight = "0";
  }
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

  // Remove expandable content and buttons
  const removeElements = clone.querySelectorAll(
    ".toggle-response, .expandable-content"
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
    const isExpandable =
      log.message.startsWith("Found relevant content in") ||
      log.message.startsWith("Generated response:");

    logEntry.className = `log-entry ${log.level}${
      isExpandable ? " expandable" : ""
    }`;
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
    if (isExpandable) {
      // For expandable entries
      logEntry.addEventListener("click", (e) => {
        // If clicking inside the expandable content, copy to clipboard
        if (e.target.closest(".expandable-content")) {
          copyToClipboard(getContentForLog(log));
          e.stopPropagation();
        } else {
          // If clicking anywhere else (except the thumbnail), toggle the response
          const thumbnail = e.target.closest(".content-thumbnail");
          if (!thumbnail) {
            toggleResponse(logEntry);
          }
        }
      });

      // Add specific click handler for the toggle button
      const toggleBtn = logEntry.querySelector(".toggle-response");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleResponse(logEntry);
        });
      }
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
      const isExpandable =
        log.message.startsWith("Found relevant content in") ||
        log.message.startsWith("Generated response:");

      logEntry.className = `log-entry ${log.level}${
        isExpandable ? " expandable" : ""
      }`;
      logEntry.innerHTML = `
        <span class="timestamp">${log.timestamp}</span>
        <span class="message">${formatLogMessage(log)}</span>
      `;

      if (isExpandable) {
        logEntry.addEventListener("click", (e) => {
          // If clicking inside the expandable content, copy to clipboard
          if (e.target.closest(".expandable-content")) {
            copyToClipboard(getContentForLog(log));
            e.stopPropagation();
          } else {
            // If clicking anywhere else (except the thumbnail), toggle the response
            const thumbnail = e.target.closest(".content-thumbnail");
            if (!thumbnail) {
              toggleResponse(logEntry);
            }
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

// Update the click handlers to use the same content extraction logic
function getContentForLog(log) {
  if (log.message.startsWith("Found relevant content in")) {
    return log.matches
      ? log.matches
          .map((match) => match.metadata.text_content)
          .join("\n\n---\n\n")
      : log.contexts
      ? log.contexts.map((ctx) => ctx.text).join("\n\n")
      : log.text_content || "No content available";
  } else if (log.message.startsWith("Generated response:")) {
    return (
      log.message.substring("Generated response:".length).trim() ||
      "No response content available"
    );
  }
  return "No content available";
}
