const MAX_PROCESS_PIXELS = 2_500_000;
const PALETTE_SAMPLE_LIMIT = 12_000;
const KMEANS_ITERATIONS = 9;

const elements = {
  imageInput: document.querySelector("#imageInput"),
  dropzone: document.querySelector("#dropzone"),
  blockSize: document.querySelector("#blockSize"),
  blockSizeOutput: document.querySelector("#blockSizeOutput"),
  colorCountOutput: document.querySelector("#colorCountOutput"),
  colorInputs: document.querySelectorAll("input[name='colorCount']"),
  gridToggle: document.querySelector("#gridToggle"),
  palette: document.querySelector("#palette"),
  paletteCount: document.querySelector("#paletteCount"),
  downloadBtn: document.querySelector("#downloadBtn"),
  originalCanvas: document.querySelector("#originalCanvas"),
  resultCanvas: document.querySelector("#resultCanvas"),
  resultWrap: document.querySelector(".result-wrap"),
  originalEmpty: document.querySelector("#originalEmpty"),
  resultEmpty: document.querySelector("#resultEmpty"),
  imageMeta: document.querySelector("#imageMeta"),
  gridMeta: document.querySelector("#gridMeta"),
  originalSize: document.querySelector("#originalSize"),
  resultSize: document.querySelector("#resultSize"),
};

const state = {
  sourceData: null,
  sourceWidth: 0,
  sourceHeight: 0,
  naturalWidth: 0,
  naturalHeight: 0,
  fileName: "piksellestirilmis-gorsel",
  blockSize: Number(elements.blockSize.value),
  colorCount: 4,
  showGrid: elements.gridToggle.checked,
  currentGrid: null,
  renderTimer: 0,
};

const sourceCanvas = document.createElement("canvas");
const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
const originalContext = elements.originalCanvas.getContext("2d");
const resultContext = elements.resultCanvas.getContext("2d");

bindEvents();
updateControlLabels();
renderPalette([]);

function bindEvents() {
  elements.imageInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) {
      loadImageFile(file);
    }
  });

  elements.blockSize.addEventListener("input", () => {
    state.blockSize = Number(elements.blockSize.value);
    updateControlLabels();
    scheduleRender();
  });

  elements.colorInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.colorCount = Number(input.value);
      updateControlLabels();
      scheduleRender();
    });
  });

  elements.gridToggle.addEventListener("change", () => {
    state.showGrid = elements.gridToggle.checked;
    scheduleRender();
  });

  elements.downloadBtn.addEventListener("click", downloadResult);

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("drag-over");
    });
  });

  elements.dropzone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) {
      loadImageFile(file);
    }
  });

  window.addEventListener("resize", applyResultPreviewSize);

  if ("ResizeObserver" in window) {
    const resultResizeObserver = new ResizeObserver(applyResultPreviewSize);
    resultResizeObserver.observe(elements.resultWrap);
  }
}

async function loadImageFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("Geçerli bir görsel seçin", "-");
    return;
  }

  setStatus("Görsel yükleniyor", "-");
  elements.downloadBtn.disabled = true;

  try {
    const image = await createDrawableImage(file);
    const size = getProcessSize(image.width, image.height);

    state.naturalWidth = image.width;
    state.naturalHeight = image.height;
    state.sourceWidth = size.width;
    state.sourceHeight = size.height;
    state.fileName = file.name.replace(/\.[^.]+$/, "") || state.fileName;

    sourceCanvas.width = size.width;
    sourceCanvas.height = size.height;
    sourceContext.clearRect(0, 0, size.width, size.height);
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
    sourceContext.drawImage(image, 0, 0, size.width, size.height);

    elements.originalCanvas.width = size.width;
    elements.originalCanvas.height = size.height;
    originalContext.clearRect(0, 0, size.width, size.height);
    originalContext.drawImage(sourceCanvas, 0, 0);

    state.sourceData = sourceContext.getImageData(0, 0, size.width, size.height);

    showCanvas(elements.originalCanvas, elements.originalEmpty);
    elements.originalSize.textContent = formatSize(size.width, size.height);
    setStatus(getImageMetaText(), "-");
    scheduleRender();

    if (typeof image.close === "function") {
      image.close();
    }
  } catch (error) {
    console.error(error);
    setStatus("Görsel okunamadı", "-");
  }
}

function scheduleRender() {
  if (!state.sourceData) return;
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(processImage, 40);
}

function processImage() {
  const width = state.sourceWidth;
  const height = state.sourceHeight;
  const blockSize = state.blockSize;
  const grid = getGridSize(width, height, blockSize);
  state.currentGrid = grid;

  setStatus(getImageMetaText(), "İşleniyor");

  const blocks = collectBlocks(state.sourceData.data, width, height, blockSize, grid);
  const palette = createPalette(blocks, state.colorCount);

  elements.resultCanvas.width = grid.outputWidth;
  elements.resultCanvas.height = grid.outputHeight;
  resultContext.clearRect(0, 0, grid.outputWidth, grid.outputHeight);
  const colorUsage = drawPixelatedResult(
    resultContext,
    blocks,
    palette,
  );

  showCanvas(elements.resultCanvas, elements.resultEmpty);
  applyResultPreviewSize();
  renderPalette(colorUsage);
  updateResultMeta(colorUsage, grid);
  elements.downloadBtn.disabled = colorUsage.length === 0;
}

function collectBlocks(data, width, height, blockSize, grid) {
  const blocks = [];

  for (let row = 0; row < grid.rows; row += 1) {
    const y = row * blockSize;
    const sampleHeight = Math.min(blockSize, height - y);

    for (let column = 0; column < grid.columns; column += 1) {
      const x = column * blockSize;
      const sampleWidth = Math.min(blockSize, width - x);
      let weightedRed = 0;
      let weightedGreen = 0;
      let weightedBlue = 0;
      let alphaWeight = 0;
      let alphaTotal = 0;

      for (let yy = 0; yy < sampleHeight; yy += 1) {
        const rowStart = ((y + yy) * width + x) * 4;

        for (let xx = 0; xx < sampleWidth; xx += 1) {
          const index = rowStart + xx * 4;
          const alpha = data[index + 3] / 255;
          alphaTotal += data[index + 3];
          weightedRed += data[index] * alpha;
          weightedGreen += data[index + 1] * alpha;
          weightedBlue += data[index + 2] * alpha;
          alphaWeight += alpha;
        }
      }

      const area = sampleWidth * sampleHeight;
      const averageAlpha = Math.round(alphaTotal / area);
      const hasVisiblePixels = alphaWeight > 0.01;

      blocks.push({
        x,
        y,
        width: blockSize,
        height: blockSize,
        area,
        r: hasVisiblePixels ? Math.round(weightedRed / alphaWeight) : 255,
        g: hasVisiblePixels ? Math.round(weightedGreen / alphaWeight) : 255,
        b: hasVisiblePixels ? Math.round(weightedBlue / alphaWeight) : 255,
        a: hasVisiblePixels && averageAlpha > 16 ? 255 : 0,
      });
    }
  }

  return blocks;
}

function createPalette(blocks, desiredCount) {
  const visibleBlocks = blocks.filter((block) => block.a > 16);
  if (!visibleBlocks.length) return [];

  const colorCount = Math.min(desiredCount, visibleBlocks.length);
  const samples = sampleBlocks(visibleBlocks);
  let centroids = initializeCentroids(samples, colorCount);

  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration += 1) {
    const groups = centroids.map(() => ({
      r: 0,
      g: 0,
      b: 0,
      weight: 0,
    }));

    for (const block of samples) {
      const nearestIndex = findNearestColorIndex(block, centroids);
      const weight = Math.max(1, block.area);
      groups[nearestIndex].r += block.r * weight;
      groups[nearestIndex].g += block.g * weight;
      groups[nearestIndex].b += block.b * weight;
      groups[nearestIndex].weight += weight;
    }

    centroids = centroids.map((centroid, index) => {
      const group = groups[index];
      if (group.weight === 0) return centroid;

      return {
        r: Math.round(group.r / group.weight),
        g: Math.round(group.g / group.weight),
        b: Math.round(group.b / group.weight),
      };
    });
  }

  return dedupePalette(centroids)
    .sort((left, right) => luminance(left) - luminance(right))
    .slice(0, desiredCount);
}

function sampleBlocks(blocks) {
  if (blocks.length <= PALETTE_SAMPLE_LIMIT) return blocks;

  const stride = Math.ceil(blocks.length / PALETTE_SAMPLE_LIMIT);
  const samples = [];

  for (let index = 0; index < blocks.length; index += stride) {
    samples.push(blocks[index]);
  }

  return samples;
}

function initializeCentroids(samples, count) {
  const average = weightedAverage(samples);
  const centroids = [average];

  while (centroids.length < count) {
    let farthest = samples[0];
    let farthestDistance = -1;

    for (const sample of samples) {
      const distance = distanceToPalette(sample, centroids);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = sample;
      }
    }

    centroids.push({
      r: farthest.r,
      g: farthest.g,
      b: farthest.b,
    });
  }

  return centroids;
}

function weightedAverage(samples) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightTotal = 0;

  for (const sample of samples) {
    const weight = Math.max(1, sample.area);
    red += sample.r * weight;
    green += sample.g * weight;
    blue += sample.b * weight;
    weightTotal += weight;
  }

  return {
    r: Math.round(red / weightTotal),
    g: Math.round(green / weightTotal),
    b: Math.round(blue / weightTotal),
  };
}

function drawPixelatedResult(context, blocks, palette) {
  const colorUsage = palette.map((color) => ({
    ...color,
    count: 0,
  }));

  if (!palette.length) return colorUsage;

  context.imageSmoothingEnabled = false;

  for (const block of blocks) {
    if (block.a <= 16) {
      context.clearRect(block.x, block.y, block.width, block.height);
      continue;
    }

    const colorIndex = findNearestColorIndex(block, palette);
    const color = palette[colorIndex];
    colorUsage[colorIndex].count += 1;
    context.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    context.fillRect(block.x, block.y, block.width, block.height);
  }

  return colorUsage.filter((color) => color.count > 0);
}

function findNearestColorIndex(color, palette) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < palette.length; index += 1) {
    const distance = colorDistance(color, palette[index]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function distanceToPalette(color, palette) {
  return Math.min(...palette.map((paletteColor) => colorDistance(color, paletteColor)));
}

function colorDistance(left, right) {
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;

  return red * red * 0.3 + green * green * 0.59 + blue * blue * 0.11;
}

function luminance(color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function dedupePalette(palette) {
  const seen = new Set();
  const unique = [];

  for (const color of palette) {
    const key = `${color.r},${color.g},${color.b}`;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(color);
  }

  return unique;
}

function renderPalette(palette) {
  elements.palette.replaceChildren();
  const totalPieces = palette.reduce((total, color) => total + (color.count ?? 0), 0);
  elements.paletteCount.textContent = palette.length
    ? `${palette.length} renk / ${totalPieces.toLocaleString("tr-TR")} parça`
    : "0 renk";

  for (const color of palette) {
    const swatch = document.createElement("span");
    const hex = rgbToHex(color);
    const hexLabel = document.createElement("span");
    const countLabel = document.createElement("span");

    swatch.className = "swatch";
    swatch.classList.toggle("is-light", luminance(color) > 172);
    swatch.style.backgroundColor = hex;
    swatch.title = `${hex} - ${(color.count ?? 0).toLocaleString("tr-TR")} parça`;

    hexLabel.className = "swatch-hex";
    hexLabel.textContent = hex;

    countLabel.className = "swatch-count";
    countLabel.textContent = `${(color.count ?? 0).toLocaleString("tr-TR")} parça`;

    swatch.append(hexLabel, countLabel);
    elements.palette.append(swatch);
  }
}

function updateResultMeta(colorUsage, grid) {
  const visiblePieces = colorUsage.reduce((total, color) => total + color.count, 0);

  elements.resultSize.textContent = formatSize(grid.outputWidth, grid.outputHeight);
  setStatus(
    getImageMetaText(),
    `${grid.columns} x ${grid.rows} eşit blok, ${visiblePieces.toLocaleString("tr-TR")} renkli parça, ${colorUsage.length} renk`,
  );
}

function applyResultPreviewSize() {
  if (!state.currentGrid) return;

  const availableSize = getAvailablePreviewSize(elements.resultWrap);
  const cellWidth = Math.floor(availableSize.width / state.currentGrid.columns);
  const cellHeight = Math.floor(availableSize.height / state.currentGrid.rows);
  const displayCellSize = Math.max(1, Math.min(96, cellWidth, cellHeight));

  elements.resultCanvas.style.width = `${state.currentGrid.columns * displayCellSize}px`;
  elements.resultCanvas.style.height = `${state.currentGrid.rows * displayCellSize}px`;
  elements.resultWrap.style.setProperty(
    "--preview-width",
    `${state.currentGrid.columns * displayCellSize}px`,
  );
  elements.resultWrap.style.setProperty(
    "--preview-height",
    `${state.currentGrid.rows * displayCellSize}px`,
  );
  elements.resultWrap.style.setProperty("--preview-cell-size", `${displayCellSize}px`);
  elements.resultWrap.classList.toggle(
    "show-preview-grid",
    state.showGrid && elements.resultCanvas.classList.contains("is-visible"),
  );
}

function getAvailablePreviewSize(container) {
  const rect = container.getBoundingClientRect();
  const styles = getComputedStyle(container);
  const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);

  return {
    width: Math.max(1, rect.width - horizontalPadding),
    height: Math.max(1, rect.height - verticalPadding),
  };
}

function updateControlLabels() {
  elements.blockSizeOutput.textContent = `${state.blockSize} px`;
  elements.colorCountOutput.textContent = String(state.colorCount);
}

function setStatus(imageText, gridText) {
  elements.imageMeta.textContent = imageText;
  elements.gridMeta.textContent = gridText;
}

function showCanvas(canvas, emptyElement) {
  canvas.classList.add("is-visible");
  emptyElement.classList.add("is-hidden");
}

function getImageMetaText() {
  if (!state.sourceData) return "Görsel bekleniyor";

  const workingSize = formatSize(state.sourceWidth, state.sourceHeight);
  const naturalSize = formatSize(state.naturalWidth, state.naturalHeight);

  if (workingSize === naturalSize) return workingSize;
  return `${naturalSize} -> ${workingSize}`;
}

function getProcessSize(width, height) {
  const pixels = width * height;
  if (pixels <= MAX_PROCESS_PIXELS) return { width, height };

  const scale = Math.sqrt(MAX_PROCESS_PIXELS / pixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function getGridSize(width, height, blockSize) {
  const columns = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);

  return {
    columns,
    rows,
    outputWidth: columns * blockSize,
    outputHeight: rows * blockSize,
  };
}

function formatSize(width, height) {
  return `${width.toLocaleString("tr-TR")} x ${height.toLocaleString("tr-TR")} px`;
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function downloadResult() {
  if (!state.sourceData) return;

  elements.resultCanvas.toBlob((blob) => {
    if (!blob) return;

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${slugify(state.fileName)}-${state.blockSize}px-${state.colorCount}renk.png`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

async function createDrawableImage(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be loaded"));
    };

    image.src = url;
  });
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "piksellestirilmis-gorsel";
}
