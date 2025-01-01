document.addEventListener('DOMContentLoaded', function() {
    const uploadZone = document.querySelector('.upload-zone');
    const fileInput = document.querySelector('#file-input');
    const progressBar = document.querySelector('.progress-bar');
    const progress = document.querySelector('.progress');

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
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-danger mt-3';
        alertDiv.textContent = message;
        uploadZone.appendChild(alertDiv);
        setTimeout(() => alertDiv.remove(), 5000);
    }

    function handleFiles(files) {
        if (!files.length) return;

        const formData = new FormData();
        formData.append('file', files[0]);

        progress.classList.add('active');
        progressBar.style.width = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
            }
        });

        xhr.onload = function() {
            progress.classList.remove('active');
            const response = JSON.parse(xhr.responseText);

            if (xhr.status === 200) {
                window.location.reload();
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