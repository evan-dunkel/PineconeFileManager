document.addEventListener('DOMContentLoaded', function() {
    const uploadZone = document.querySelector('.upload-zone');
    const fileInput = document.querySelector('#file-input');
    const progressBar = document.querySelector('.progress-bar');
    const progress = document.querySelector('.progress');
    const uploadStatus = document.querySelector('.upload-status');
    const uploadStatusIcon = uploadStatus.querySelector('.upload-status-icon');
    const uploadStatusText = uploadStatus.querySelector('.upload-status-text');

    function updateUploadStatus(status, message) {
        uploadStatus.classList.add('active');
        uploadStatusText.textContent = message;

        // Update icon based on status
        let iconName = 'loader';
        switch(status) {
            case 'uploading':
                iconName = 'upload-cloud';
                break;
            case 'analyzing':
                iconName = 'cpu';
                break;
            case 'processing':
                iconName = 'loader';
                break;
            case 'success':
                iconName = 'check-circle';
                break;
            case 'error':
                iconName = 'alert-circle';
                break;
        }

        uploadStatusIcon.setAttribute('data-feather', iconName);
        uploadStatusIcon.classList.remove('success', 'error');
        if (status === 'success' || status === 'error') {
            uploadStatusIcon.classList.add(status);
        }
        feather.replace();
    }

    // Drag and drop handlers
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
        setTimeout(() => {
            uploadStatus.classList.remove('active');
            progress.classList.remove('active');
        }, 5000);
    }

    function handleFiles(files) {
        if (!files.length) return;

        const formData = new FormData();
        formData.append('file', files[0]);

        progress.classList.add('active');
        progressBar.style.width = '0%';
        updateUploadStatus('uploading', 'Preparing to upload file...');

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                if (percentComplete < 100) {
                    updateUploadStatus('uploading', `Uploading: ${Math.round(percentComplete)}%`);
                } else {
                    updateUploadStatus('analyzing', 'Analyzing file content...');
                }
            }
        });

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 3) { // Processing
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
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                }
            } else {
                const response = JSON.parse(xhr.responseText);
                showError(response.error || 'Upload failed. Please try again.');
            }
        };

        xhr.onerror = function() {
            progress.classList.remove('active');
            showError('Upload failed. Please try again.');
        };

        xhr.send(formData);
    }

    // File deletion status updates
    document.querySelectorAll('form[action^="/delete/"]').forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            if (confirm('Are you sure you want to delete this file?')) {
                const deleteStatus = document.createElement('div');
                deleteStatus.className = 'alert alert-info';
                deleteStatus.innerHTML = '<i data-feather="trash-2"></i> Deleting file and associated data...';

                const fileCard = this.closest('.file-card');
                if (fileCard) {
                    fileCard.appendChild(deleteStatus);
                    feather.replace();
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
                form.submit();
            }
        });
    });
});