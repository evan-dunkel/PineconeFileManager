document.addEventListener("DOMContentLoaded", function () {
  const uploadZone = document.querySelector(".upload-zone");
  const uploadContent = document.querySelector(".upload-content");
  const fileInput = document.querySelector("#file-input");

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

  // API Logs functionality
  let lastLogTimestamp = null;

  function updateLogs() {
    fetch("/api/logs")
      .then((res) => res.json())
      .then((logs) => {
        const logsContainer = document.getElementById("api-logs");

        // Filter new logs
        const newLogs = lastLogTimestamp
          ? logs.filter((log) => log.timestamp > lastLogTimestamp)
          : logs;

        if (newLogs.length > 0) {
          // Update last timestamp
          lastLogTimestamp = logs[logs.length - 1].timestamp;

          // Clear placeholder if present
          if (logsContainer.querySelector(".text-muted")) {
            logsContainer.innerHTML = "";
          }

          // Add new logs
          newLogs.forEach((log) => {
            const logEntry = document.createElement("div");
            logEntry.className = `log-entry ${log.level}`;
            logEntry.innerHTML = `
              <span class="timestamp">${log.timestamp}</span>
              <span class="message">${log.message}</span>
            `;
            logsContainer.appendChild(logEntry);
          });

          // Scroll to bottom
          logsContainer.scrollTop = logsContainer.scrollHeight;
        }
      })
      .catch((error) => console.error("Error fetching logs:", error));
  }

  function clearLogs() {
    const logsContainer = document.getElementById("api-logs");
    logsContainer.innerHTML =
      '<div class="text-muted text-center">Waiting for API activity...</div>';
    lastLogTimestamp = null;
  }

  // Start polling for logs
  setInterval(updateLogs, 1000);
});
