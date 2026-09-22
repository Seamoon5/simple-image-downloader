// This script runs inside the context of the webpage.
// v1.1: fast mode — replies instantly with known sizes, probes the rest in the background.

function resolveUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    return null;
  }
}

function collectRawImages() {
  const rawImageDatas = [];

  const addImage = (url, type) => {
    const absoluteUrl = resolveUrl(url);
    if (absoluteUrl && absoluteUrl.startsWith('http') && !absoluteUrl.startsWith('data:')) {
      rawImageDatas.push({ url: absoluteUrl, type: type });
    }
  };

  // 1. Get images from <img> tags
  document.querySelectorAll('img').forEach(img => {
    if (img.srcset) {
      const srcsetUrls = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
      if (srcsetUrls.length > 0) {
        addImage(srcsetUrls[srcsetUrls.length - 1], 'img');
        return;
      }
    }
    if (img.dataset.srcset) {
      const srcsetUrls = img.dataset.srcset.split(',').map(s => s.trim().split(' ')[0]);
      if (srcsetUrls.length > 0) {
        addImage(srcsetUrls[srcsetUrls.length - 1], 'img');
        return;
      }
    }

    if (img.dataset.src) {
      addImage(img.dataset.src, 'img');
    } else if (img.dataset.original) {
      addImage(img.dataset.original, 'img');
    } else if (img.src) {
      addImage(img.src, 'img');
    }
  });

  // 2. Get images from <picture> and <source> tags
  document.querySelectorAll('picture source').forEach(source => {
    if (source.srcset) {
      const srcsetUrls = source.srcset.split(',').map(s => s.trim().split(' ')[0]);
      if (srcsetUrls.length > 0) {
        addImage(srcsetUrls[srcsetUrls.length - 1], 'img');
      }
    }
  });

  // 3. CSS background-image — targeted selectors instead of every element on the page
  const bgSelector = 'div,span,section,article,li,a,figure,p,header,footer,nav,td,th,button';
  document.querySelectorAll(bgSelector).forEach(element => {
    let style;
    try {
      style = window.getComputedStyle(element);
    } catch (e) {
      return;
    }
    const backgroundImage = style.backgroundImage;
    if (backgroundImage && backgroundImage !== 'none') {
      const urlMatch = backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
      if (urlMatch && urlMatch[1]) {
        addImage(urlMatch[1], 'css');
      }
    }
  });

  // 4. Get images from <a> tags that link directly to image files
  document.querySelectorAll('a').forEach(link => {
    const href = link.href;
    if (href && href.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp|tiff|ico)(\?.*)?$/i)) {
      addImage(href, 'link');
    }
  });

  const uniqueUrlMap = new Map();
  rawImageDatas.forEach(data => {
    if (!uniqueUrlMap.has(data.url)) {
      uniqueUrlMap.set(data.url, data);
    } else {
      const existingType = uniqueUrlMap.get(data.url).type;
      if (data.type === 'link' && existingType !== 'link') {
        uniqueUrlMap.set(data.url, data);
      } else if (data.type === 'img' && existingType === 'css') {
        uniqueUrlMap.set(data.url, data);
      }
    }
  });

  return Array.from(uniqueUrlMap.values());
}

// Sizes the page already knows — free, instant, no download needed.
function pageKnownDims() {
  const map = new Map();
  const remember = (url, w, h) => {
    if (!w || !h) return;
    const abs = resolveUrl(url);
    if (abs) map.set(abs, { width: w, height: h });
  };

  document.querySelectorAll('img').forEach(img => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    remember(img.currentSrc || img.src, w, h);
    remember(img.dataset.src, w, h);
    remember(img.dataset.original, w, h);
    if (img.srcset) {
      img.srcset.split(',').forEach(part => {
        const u = part.trim().split(/\s+/)[0];
        if (u) remember(u, w, h);
      });
    }
  });

  return map;
}

// Probe one URL for its real size. 2-second cap so nothing ever stalls.
function probeSize(url) {
  return new Promise((resolve) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      resolve(null);
      return;
    }
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve(null);
    }, 2000);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

// Probe with 6 in parallel; report progress in batches of 8.
async function probeUnknown(unknownUrls) {
  const CONCURRENCY = 6;
  const BATCH = 8;
  let index = 0;
  let pending = [];

  const flush = (done) => {
    if (pending.length === 0 && !done) return;
    try {
      chrome.runtime.sendMessage({ action: 'dimsUpdate', updates: pending.slice(), done: !!done });
    } catch (e) {}
    pending = [];
  };

  async function worker() {
    while (index < unknownUrls.length) {
      const i = index++;
      const url = unknownUrls[i];
      const dims = await probeSize(url);
      if (dims) {
        pending.push({ url, width: dims.width, height: dims.height });
        if (pending.length >= BATCH) flush(false);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unknownUrls.length) }, () => worker()));
  flush(true);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getImagesFromTab") {
    let raw;
    try {
      raw = collectRawImages();
    } catch (e) {
      sendResponse({ images: [] });
      return;
    }

    const known = pageKnownDims();
    const images = raw.map(data => {
      const d = known.get(data.url);
      return {
        url: data.url,
        width: d ? d.width : 0,
        height: d ? d.height : 0,
        type: data.type
      };
    });

    // Reply IMMEDIATELY — popup can show the grid right away.
    sendResponse({ images: images });

    // Measure the rest in the background and send updates to the popup.
    const unknownUrls = images.filter(img => !img.width || !img.height).map(img => img.url);
    if (unknownUrls.length > 0) {
      probeUnknown(unknownUrls);
    } else {
      try {
        chrome.runtime.sendMessage({ action: 'dimsUpdate', updates: [], done: true });
      } catch (e) {}
    }
    return;
  }
});
