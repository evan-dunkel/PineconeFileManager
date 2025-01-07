document.addEventListener("DOMContentLoaded", function () {
  const indexFilter = document.getElementById("index_filter");
  if (!indexFilter) return;

  // Restore the previously selected index
  const savedIndexId = localStorage.getItem("selectedIndexId");
  if (savedIndexId) {
    indexFilter.value = savedIndexId;
    filterFiles(savedIndexId);
  }

  indexFilter.addEventListener("change", function () {
    const selectedIndexId = this.value;
    // Save the selected index
    if (selectedIndexId) {
      localStorage.setItem("selectedIndexId", selectedIndexId);
    } else {
      localStorage.removeItem("selectedIndexId");
    }
    filterFiles(selectedIndexId);
  });
});

function filterFiles(indexId) {
  const fileWrappers = document.querySelectorAll(".file-wrapper");
  const transitionDuration = 300; // Match this with CSS transition duration

  // First, fade out cards that don't match the filter
  fileWrappers.forEach((wrapper) => {
    const card = wrapper.querySelector(".file-card");
    const cardIndexId = card.dataset.indexId;

    if (indexId && cardIndexId !== indexId) {
      card.classList.add("fade-out");
      // Hide the wrapper after the fade animation
      setTimeout(() => {
        wrapper.classList.add("hidden");
      }, transitionDuration);
    } else {
      card.classList.remove("fade-out");
      wrapper.classList.remove("hidden");
    }
  });
}
