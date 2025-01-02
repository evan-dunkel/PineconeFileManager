document.addEventListener('DOMContentLoaded', function() {
    const uploadZone = document.querySelector('.upload-zone');
    const uploadContent = document.querySelector('.upload-content');
    const fileInput = document.querySelector('#file-input');
    const progressBar = document.querySelector('.progress-bar');
    const progressContainer = document.querySelector('.progress-container');
    const uploadStatus = document.querySelector('.upload-status');
    const uploadStatusIcon = uploadStatus.querySelector('.upload-status-icon');
    const uploadStatusText = uploadStatus.querySelector('.upload-status-text');
    const stageIndicator = document.querySelector('.stage-indicator');

    let processingStartTime = null;
    let shouldShowDetailedStatus = false;

    function showProcessingUI() {
        uploadContent.classList.add('hidden');
        progressContainer.classList.add('active');
        stageIndicator.classList.add('active');
    }

    function resetUI() {
        uploadContent.classList.remove('hidden');
        progressContainer.classList.remove('active');
        stageIndicator.classList.remove('active');
        uploadStatus.classList.remove('active');
        progressBar.style.width = '0%';
        processingStartTime = null;
        shouldShowDetailedStatus = false;
    }

    function updateStage(stageName) {
        const stages = ['upload', 'analyze', 'process', 'complete'];
        const currentIndex = stages.indexOf(stageName);

        stages.forEach((stage, index) => {
            const stageElement = document.querySelector(`.stage[data-stage="${stage}"]`);
            if (index < currentIndex) {
                stageElement.classList.add('completed');
                stageElement.classList.remove('active');
            } else if (index === currentIndex) {
                stageElement.classList.add('active');
                stageElement.classList.remove('completed');
            } else {
                stageElement.classList.remove('completed', 'active');
            }
        });
    }

    function updateUploadStatus(status, message, forceShow = false) {
        const now = Date.now();

        if (status === 'uploading') {
            showProcessingUI();
        }

        if (status === 'analyzing' && !processingStartTime) {
            processingStartTime = now;
            shouldShowDetailedStatus = false;
            setTimeout(() => {
                shouldShowDetailedStatus = true;
                if (uploadStatus.classList.contains('active') && !uploadStatus.querySelector('.success')) {
                    uploadStatusText.textContent = message;
                }
            }, 5000);
        }

        const showImmediately = status === 'uploading' || status === 'success' || status === 'error' || forceShow;

        if (showImmediately || shouldShowDetailedStatus) {
            uploadStatus.classList.add('active');
            uploadStatusText.textContent = message;
        } else if (status === 'analyzing' || status === 'processing') {
            uploadStatusText.textContent = 'Processing...';
        }

        let iconName = 'loader';
        let stageName = 'upload';

        switch(status) {
            case 'uploading':
                iconName = 'loader';
                stageName = 'upload';
                break;
            case 'analyzing':
                iconName = 'loader';
                stageName = 'analyze';
                break;
            case 'processing':
                iconName = 'loader';
                stageName = 'process';
                break;
            case 'success':
                iconName = 'check-circle';
                stageName = 'complete';
                // Don't reset UI on success, let the page refresh handle it
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
                break;
            case 'error':
                iconName = 'alert-circle';
                resetUI();
                break;
        }

        uploadStatusIcon.setAttribute('data-feather', iconName);
        uploadStatusIcon.classList.remove('success', 'error', 'processing');

        if (status === 'success' || status === 'error') {
            uploadStatusIcon.classList.add(status);
        } else {
            uploadStatusIcon.classList.add('processing');
        }

        updateStage(stageName);
        feather.replace();
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        uploadZone.classList.add('dragover');
    }

    function unhighlight() {
        uploadZone.classList.remove('dragover');
    }

    uploadZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    function showError(message) {
        updateUploadStatus('error', message);
    }

    function handleFiles(files) {
        if (!files.length) return;

        const formData = new FormData();
        formData.append('file', files[0]);

        progressContainer.classList.add('active');
        progressBar.style.width = '0%';
        updateUploadStatus('uploading', 'Preparing to upload file...', true);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                if (percentComplete < 100) {
                    updateUploadStatus('uploading', `Uploading: ${Math.round(percentComplete)}%`, true);
                } else {
                    updateUploadStatus('analyzing', 'Analyzing file content...');
                }
            }
        });

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 3) {
                updateUploadStatus('processing', 'Processing file...');
            }
        };

        xhr.onload = function() {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                if (response.status === 'processing') {
                    updateUploadStatus('processing', response.message || 'Vectorizing content...');
                } else {
                    updateUploadStatus('success', 'Upload complete!');
                }
            } else {
                const response = JSON.parse(xhr.responseText);
                showError(response.error || 'Upload failed. Please try again.');
            }
        };

        xhr.onerror = function() {
            showError('Upload failed. Please try again.');
        };

        xhr.send(formData);
    }

    // File deletion functionality
    document.querySelectorAll('form[action^="/delete/"]').forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            if (confirm('Are you sure you want to delete this file?')) {
                const fileCard = this.closest('.file-card');
                const deleteStatus = document.createElement('div');
                deleteStatus.className = 'alert alert-info d-flex align-items-center';
                deleteStatus.innerHTML = `
                    <i data-feather="trash-2" class="me-2"></i>
                    <span>Deleting file and associated data...</span>
                `;

                if (fileCard) {
                    fileCard.appendChild(deleteStatus);
                    feather.replace();

                    fileCard.style.transition = 'opacity 0.5s ease';
                    fileCard.style.opacity = '0.5';
                }

                this.submit();
            }
        });
    });

    // File rename functionality
    document.querySelectorAll('.rename-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const fileId = this.dataset.fileId;
            const currentName = this.dataset.fileName;
            const newName = prompt('Enter new filename:', currentName);

            if (newName && newName !== currentName) {
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = `/rename/${fileId}`;

                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = 'new_name';
                input.value = newName;

                form.appendChild(input);
                document.body.appendChild(form);

                const fileCard = this.closest('.file-card');
                const fileNameElement = fileCard.querySelector('.file-name');
                fileNameElement.style.transition = 'opacity 0.3s ease';
                fileNameElement.style.opacity = '0';

                setTimeout(() => {
                    fileNameElement.textContent = newName;
                    fileNameElement.style.opacity = '1';
                    form.submit();
                }, 300);
            }
        });
    });
});