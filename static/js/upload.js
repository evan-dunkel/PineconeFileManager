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
        uploadStatusIcon.setAttribute('data-feather', status === 'success' ? 'check-circle' : 
                                                    status === 'error' ? 'alert-circle' : 'loader');
        uploadStatusIcon.classList.remove('success', 'error');
        if (status !== 'uploading') {
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
        }, 5000);
    }

    function handleFiles(files) {
        if (!files.length) return;

        const formData = new FormData();
        formData.append('file', files[0]);

        progress.classList.add('active');
        progressBar.style.width = '0%';
        updateUploadStatus('uploading', 'Uploading file...');

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                updateUploadStatus('uploading', `Uploading: ${Math.round(percentComplete)}%`);
            }
        });

        xhr.onload = function() {
            progress.classList.remove('active');
            const response = JSON.parse(xhr.responseText);

            if (xhr.status === 200) {
                updateUploadStatus('success', 'Upload complete!');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                showError(response.error || 'Upload failed. Please try again.');
            }
        };

        xhr.onerror = function() {
            progress.classList.remove('active');
            showError('Upload failed. Please try again.');
        };

        xhr.send(formData);
    }

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