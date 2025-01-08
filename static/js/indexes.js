document.addEventListener("DOMContentLoaded", function () {
  // Initialize clipboard.js
  const clipboard = new ClipboardJS(".copy-btn");

  // Handle success
  clipboard.on("success", function (e) {
    const button = e.trigger;
    const originalContent = button.innerHTML;

    // Change the icon to a check mark temporarily
    button.innerHTML = '<i class="bi bi-check"></i>';

    // Reset back to clipboard icon after 2 seconds
    setTimeout(() => {
      button.innerHTML = '<i class="bi bi-clipboard"></i>';
    }, 2000);

    e.clearSelection();
  });

  // Handle errors
  clipboard.on("error", function (e) {
    console.error("Copy failed:", e);
  });
});
