// popup.js — v1.1: instant gallery, lazy thumbnails, live size updates, light/dark theme
document.addEventListener('DOMContentLoaded', () => {
  const imageGallery = document.getElementById('image-gallery');
  const statusMessage = document.getElementById('status-message');
  const downloadBtn = document.getElementById('download-btn');
  const minWidthInput = document.getElementById('min-width');
  const minHeightInput = document.getElementById('min-height');
  const onlyLinksCheckbox = document.getElementById('only-links-checkbox');
  const applyFiltersBtn = document.getElementById('apply-filters-btn');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const searchAllTabsBtn = document.getElementById('search-all-tabs-btn');
  const folderNameInput = document.getElementById('folder-name');
  const themeToggleBtn = document.getElementById('theme-toggle');

  let allDetectedImages = [];
  let selectionMap = new Map(); // url -> bool (user's checkbox choices survive re-renders)
  let dimsTimer = null;

  // --- Theme (light / dark) ---
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggleBtn) {
      themeToggleBtn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
      themeToggleBtn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  function loadTheme() {
    chrome.storage.local.get(['theme'], (result) => {
      applyTheme(result.theme === 'dark' ? 'dark' : 'light');
    });
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      chrome.storage.local.set({ theme: next });
    });
  }

  // --- Saved settings ---
  function loadSettings() {
    chrome.storage.local.get(['minWidth', 'minHeight', 'onlyLinksChecked'], (result) => {
      minWidthInput.value = result.minWidth !== undefined ? result.minWidth : 0;
      minHeightInput.value = result.minHeight !== undefined ? result.minHeight : 0;
      onlyLinksCheckbox.checked = result.onlyLinksChecked !== undefined ? result.onlyLinksChecked : false;
      requestImagesFromCurrentTab();
    });
  }

  function saveSettings() {
    chrome.storage.local.set({
      minWidth: parseInt(minWidthInput.value) || 0,
      minHeight: parseInt(minHeightInput.value) || 0,
      onlyLinksChecked: onlyLinksCheckbox.checked
    });
  }

  // --- Live size updates from content.js (arrives after the instant reply) ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'dimsUpdate' && request.updates) {
      const sizeByUrl = new Map();
      request.updates.forEach(u => sizeByUrl.set(u.url, u));

      let changed = false;
      allDetectedImages.forEach(img => {
        const u = sizeByUrl.get(img.url);
        if (u && (!img.width || !img.height)) {
          img.width = u.width;
          img.height = u.height;
          changed = true;
        }
      });

      if (changed) {
        // Debounced so batches don't re-render the grid constantly
        clearTimeout(dimsTimer);
        dimsTimer = setTimeout(() => {
          applyFilters(true);
          if (request.done) {
            statusMessage.textContent = statusMessage.textContent.replace(/ Loading sizes…$/, '') + '';
          }
        }, 300);
      } else if (request.done) {
        statusMessage.textContent = statusMessage.textContent.replace(/ Loading sizes…$/, '') + '';
      }
    }
  });

  // --- Request images from current tab ---
  function requestImagesFromCurrentTab() {
    statusMessage.textContent = "Loading images from current tab...";
    imageGallery.innerHTML = '';
    selectionMap = new Map();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            files: ['content.js']
          },
          () => {
            if (chrome.runtime.lastError) {
              statusMessage.textContent = "Error injecting content script. Please ensure you are on a standard web page.";
              console.error("Scripting injection error:", chrome.runtime.lastError.message);
              return;
            }

            chrome.tabs.sendMessage(activeTab.id, { action: "getImagesFromTab" }, (response) => {
              if (chrome.runtime.lastError) {
                statusMessage.textContent = "Could not get images from this tab. Try refreshing the page.";
                console.error("Error sending message to content script:", chrome.runtime.lastError.message);
                return;
              }
              if (response && response.images && response.images.length > 0) {
                allDetectedImages = response.images;
                const unknown = allDetectedImages.filter(i => !i.width || !i.height).length;
                applyFilters();
                if (unknown > 0) {
                  statusMessage.textContent += " Loading sizes…";
                }
              } else {
                statusMessage.textContent = "No images found on this tab.";
                allDetectedImages = [];
              }
            });
          }
        );
      } else {
        statusMessage.textContent = "No active tab found.";
      }
    });
  }

  // --- Request images from ALL tabs ---
  function requestImagesFromAllTabs() {
    statusMessage.textContent = "Searching all open tabs for images... This may take a moment.";
    imageGallery.innerHTML = '';
    allDetectedImages = [];
    selectionMap = new Map();

    chrome.runtime.sendMessage({ action: "searchAllTabsForImages" }, (response) => {
      if (chrome.runtime.lastError) {
        statusMessage.textContent = "Error communicating with background script.";
        console.error("Error sending message to background script:", chrome.runtime.lastError.message);
        return;
      }
      if (response && response.status === "done") {
        if (response.images && response.images.length > 0) {
          allDetectedImages = response.images;
          applyFilters();
        } else {
          statusMessage.textContent = "No images found across all open tabs.";
        }
      } else {
        statusMessage.textContent = "Error during search across all tabs.";
      }
    });
  }

  // --- Apply filters and display ---
  function applyFilters(isSilent) {
    saveSettings();

    const minWidth = parseInt(minWidthInput.value) || 0;
    const minHeight = parseInt(minHeightInput.value) || 0;
    const onlyLinks = onlyLinksCheckbox.checked;

    let filteredImages = allDetectedImages.filter(imgData => {
      // Unknown size (still probing) stays visible; known-but-too-small is hidden.
      const unknown = !imgData.width && !imgData.height;
      if (!unknown && (imgData.width < minWidth || imgData.height < minHeight)) return false;
      if (onlyLinks && imgData.type !== 'link') return false;
      return true;
    });

    if (!isSilent) {
      let msg = `Found ${filteredImages.length} images (filtered from ${allDetectedImages.length}).`;
      statusMessage.textContent = msg;
    }
    displayImages(filteredImages);
  }

  function displayImages(imageArray) {
    if (imageArray.length === 0) {
      imageGallery.innerHTML = '<p class="empty-msg">No images found with current filters.</p>';
      return;
    }

    const html = imageArray.map(imgData => {
      const checked = selectionMap.has(imgData.url) ? selectionMap.get(imgData.url) : true;
      const sizeText = (imgData.width && imgData.height) ? `${imgData.width}×${imgData.height}` : '…';
      return `
        <div class="image-item" data-url="${escapeAttr(imgData.url)}" title="Size: ${sizeText} (Type: ${imgData.type})">
          <img src="${escapeAttr(imgData.url)}" alt="Image" loading="lazy" decoding="async">
          <span class="size-badge">${sizeText}</span>
          <input type="checkbox" ${checked ? 'checked' : ''} data-url="${escapeAttr(imgData.url)}">
        </div>
      `;
    }).join('');

    imageGallery.innerHTML = html;

    imageGallery.querySelectorAll('img').forEach(im => {
      im.addEventListener('error', function () {
        this.src = 'icons/icon48.png';
        this.title = 'Broken image link: ' + this.closest('.image-item').dataset.url;
      });
    });

    imageGallery.querySelectorAll('.image-item').forEach(item => {
      item.addEventListener('click', (event) => {
        if (event.target.tagName === 'INPUT') return;
        const cb = item.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        selectionMap.set(item.dataset.url, cb.checked);
      });
    });

    imageGallery.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        selectionMap.set(cb.dataset.url, cb.checked);
      });
    });
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // --- Download selected ---
  downloadBtn.addEventListener('click', () => {
    const selectedCheckboxes = document.querySelectorAll('#image-gallery input[type="checkbox"]:checked');
    const urlsToDownload = Array.from(selectedCheckboxes).map(checkbox => checkbox.dataset.url);

    if (urlsToDownload.length === 0) {
      statusMessage.textContent = "No images selected for download.";
      return;
    }

    const folderName = folderNameInput.value.trim();
    statusMessage.textContent = `Downloading ${urlsToDownload.length} images...`;

    urlsToDownload.forEach((url, index) => {
      let filename = `image_download_${Date.now()}_${index}.${getFileExtension(url)}`;
      if (folderName) {
        filename = `${folderName}/${filename}`;
      }

      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error(`Error downloading ${url}:`, chrome.runtime.lastError.message);
        }
      });
    });

    setTimeout(() => {
      statusMessage.textContent = `Finished attempting to download ${urlsToDownload.length} images.`;
    }, 1000);
  });

  function getFileExtension(url) {
    const parts = url.split('.');
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1];
      const extension = lastPart.split('?')[0].split('#')[0].toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico'].includes(extension)) {
        return extension;
      }
    }
    return 'jpg';
  }

  // --- Filter / selection event listeners ---
  applyFiltersBtn.addEventListener('click', () => applyFilters());
  minWidthInput.addEventListener('change', () => applyFilters());
  minHeightInput.addEventListener('change', () => applyFilters());
  onlyLinksCheckbox.addEventListener('change', () => applyFilters());

  selectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('#image-gallery input[type="checkbox"]').forEach(checkbox => {
      checkbox.checked = true;
      selectionMap.set(checkbox.dataset.url, true);
    });
  });

  deselectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('#image-gallery input[type="checkbox"]').forEach(checkbox => {
      checkbox.checked = false;
      selectionMap.set(checkbox.dataset.url, false);
    });
  });

  searchAllTabsBtn.addEventListener('click', requestImagesFromAllTabs);

  // Initial: theme first (no flash), then settings + images.
  loadTheme();
  loadSettings();
});
