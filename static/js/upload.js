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
