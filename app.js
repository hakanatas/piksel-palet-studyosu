const MAX_PROCESS_PIXELS = 2_500_000;
const PALETTE_SAMPLE_LIMIT = 12_000;
const KMEANS_ITERATIONS = 9;

const elements = {
  imageInput: document.querySelector("#imageInput"),
  dropzone: document.querySelector("#dropzone"),
  blockSize: document.querySelector("#blockSize"),
  blockSizeOutput: document.querySelector("#blockSizeOutput"),
  physicalGridToggle: document.querySelector("#physicalGridToggle"),
  gridColumns: document.querySelector("#gridColumns"),
  gridRows: document.querySelector("#gridRows"),
  colorCountOutput: document.querySelector("#colorCountOutput"),
  colorInputs: document.querySelectorAll("input[name='colorCount']"),
  gridToggle: document.querySelector("#gridToggle"),
  includeEmptyToggle: document.querySelector("#includeEmptyToggle"),
  palette: document.querySelector("#palette"),
  paletteCount: document.querySelector("#paletteCount"),
  placementList: document.querySelector("#placementList"),
  placementCount: document.querySelector("#placementCount"),
  copyListBtn: document.querySelector("#copyListBtn"),
  downloadListBtn: document.querySelector("#downloadListBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  originalCanvas: document.querySelector("#originalCanvas"),
  resultCanvas: document.querySelector("#resultCanvas"),
  resultWrap: document.querySelector(".result-wrap"),
  coordinateLabels: document.querySelector("#coordinateLabels"),
  hoverBadge: document.querySelector("#hoverBadge"),
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
  physicalGridMode: elements.physicalGridToggle.checked,
  gridColumns: Number(elements.gridColumns.value),
  gridRows: Number(elements.gridRows.value),
  colorCount: 4,
  showGrid: elements.gridToggle.checked,
  includeEmptyCells: elements.includeEmptyToggle.checked,
  currentGrid: null,
  cellPlacements: [],
  editPalette: [],
  placementCsv: "",
  renderTimer: 0,
};

const sourceCanvas = document.createElement("canvas");
const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
const originalContext = elements.originalCanvas.getContext("2d");
const resultContext = elements.resultCanvas.getContext("2d");

bindEvents();
updateControlLabels();
renderPalette([]);
renderPlacementList();

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

  elements.physicalGridToggle.addEventListener("change", () => {
    state.physicalGridMode = elements.physicalGridToggle.checked;
    updateControlLabels();
    scheduleRender();
  });

  [elements.gridColumns, elements.gridRows].forEach((input) => {
    input.addEventListener("input", () => {
      state.gridColumns = clampInteger(elements.gridColumns.value, 1, 200);
      state.gridRows = clampInteger(elements.gridRows.value, 1, 200);
      updateControlLabels();
      scheduleRender();
    });
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
    applyResultPreviewSize();
  });

  elements.includeEmptyToggle.addEventListener("change", () => {
    state.includeEmptyCells = elements.includeEmptyToggle.checked;
    renderPlacementList();
  });

  elements.downloadBtn.addEventListener("click", downloadResult);
  elements.copyListBtn.addEventListener("click", copyPlacementList);
  elements.downloadListBtn.addEventListener("click", downloadPlacementList);

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

  elements.resultWrap.addEventListener("mousemove", updateHoverBadge);
  elements.resultWrap.addEventListener("mouseleave", hideHoverBadge);
  elements.resultCanvas.addEventListener("click", cycleCellColor);

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
  const grid = getActiveGrid(width, height);
  state.currentGrid = grid;

  setStatus(getImageMetaText(), "İşleniyor");

  const blocks = collectBlocks(state.sourceData.data, width, height, grid);
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
  state.editPalette = colorUsage.map(({ count, ...color }) => color);
  renderPalette(colorUsage);
  updatePlacements(blocks, palette);
  updateResultMeta(colorUsage, grid);
  elements.downloadBtn.disabled = colorUsage.length === 0;
}

function collectBlocks(data, width, height, grid) {
  const blocks = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const sample = getSampleBounds(column, row, width, height, grid);
      let weightedRed = 0;
      let weightedGreen = 0;
      let weightedBlue = 0;
      let alphaWeight = 0;
      let alphaTotal = 0;

      for (let yy = 0; yy < sample.height; yy += 1) {
        const rowStart = ((sample.y + yy) * width + sample.x) * 4;

        for (let xx = 0; xx < sample.width; xx += 1) {
          const index = rowStart + xx * 4;
          const alpha = data[index + 3] / 255;
          alphaTotal += data[index + 3];
          weightedRed += data[index] * alpha;
          weightedGreen += data[index + 1] * alpha;
          weightedBlue += data[index + 2] * alpha;
          alphaWeight += alpha;
        }
      }

      const area = sample.width * sample.height;
      const averageAlpha = Math.round(alphaTotal / area);
      const hasVisiblePixels = alphaWeight > 0.01;

      blocks.push({
        column,
        row,
        x: column * grid.cellSize,
        y: row * grid.cellSize,
        width: grid.cellSize,
        height: grid.cellSize,
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

function updatePlacements(blocks, palette) {
  state.cellPlacements = blocks.map((block) => {
    if (block.a <= 16 || !palette.length) {
      return {
        x: block.column + 1,
        y: block.row + 1,
        color: "boş",
        hex: "",
        empty: true,
      };
    }

    const color = palette[findNearestColorIndex(block, palette)];
    const hex = rgbToHex(color).toUpperCase();

    return {
      x: block.column + 1,
      y: block.row + 1,
      color: hex,
      hex,
      empty: false,
    };
  });

  renderPlacementList();
}

function renderPlacementList() {
  const placements = state.includeEmptyCells
    ? state.cellPlacements
    : state.cellPlacements.filter((cell) => !cell.empty);
  const maxListSize = 5_000;

  if (!state.cellPlacements.length) {
    state.placementCsv = "";
    elements.placementList.value = "";
    elements.placementCount.textContent = "0 hücre";
    elements.copyListBtn.disabled = true;
    elements.downloadListBtn.disabled = true;
    return;
  }

  if (placements.length > maxListSize) {
    state.placementCsv = "";
    elements.placementList.value =
      `Liste ${placements.length.toLocaleString("tr-TR")} hücre içeriyor. ` +
      "CSV için daha küçük bir ızgara kullanın.";
    elements.placementCount.textContent = `${placements.length.toLocaleString("tr-TR")} hücre`;
    elements.copyListBtn.disabled = true;
    elements.downloadListBtn.disabled = true;
    return;
  }

  state.placementCsv = [
    "x,y,renk",
    ...placements.map((cell) => `${cell.x},${cell.y},${cell.color}`),
  ].join("\n");

  elements.placementList.value = state.placementCsv;
  elements.placementCount.textContent = `${placements.length.toLocaleString("tr-TR")} hücre`;
  elements.copyListBtn.disabled = placements.length === 0;
  elements.downloadListBtn.disabled = placements.length === 0;
}

function updateResultMeta(colorUsage, grid) {
  const visiblePieces = colorUsage.reduce((total, color) => total + color.count, 0);

  elements.resultSize.textContent = state.physicalGridMode
    ? `${grid.columns} x ${grid.rows} hücre`
    : formatSize(grid.outputWidth, grid.outputHeight);
  setStatus(
    getImageMetaText(),
    `${grid.columns} x ${grid.rows} eşit blok, ${visiblePieces.toLocaleString("tr-TR")} renkli hücre, ${colorUsage.length} renk`,
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
  elements.resultWrap.style.setProperty(
    "--coordinate-font-size",
    `${Math.max(7, Math.min(10, Math.floor(displayCellSize * 0.45)))}px`,
  );
  elements.resultWrap.classList.toggle(
    "show-preview-grid",
    state.showGrid && elements.resultCanvas.classList.contains("is-visible"),
  );
  elements.resultWrap.classList.toggle(
    "show-coordinate-labels",
    state.physicalGridMode && elements.resultCanvas.classList.contains("is-visible"),
  );
  renderCoordinateLabels(displayCellSize);
}

function renderCoordinateLabels(cellSize) {
  elements.coordinateLabels.replaceChildren();

  if (!state.currentGrid || !state.physicalGridMode) return;

  for (let column = 0; column < state.currentGrid.columns; column += 1) {
    const label = document.createElement("span");
    label.className = "coord-label coord-label-x";
    label.style.left = `${column * cellSize + cellSize / 2}px`;
    label.textContent = String(column + 1);
    elements.coordinateLabels.append(label);
  }

  for (let row = 0; row < state.currentGrid.rows; row += 1) {
    const label = document.createElement("span");
    label.className = "coord-label coord-label-y";
    label.style.top = `${row * cellSize + cellSize / 2}px`;
    label.textContent = String(row + 1);
    elements.coordinateLabels.append(label);
  }
}

function updateHoverBadge(event) {
  if (!state.currentGrid || !elements.resultCanvas.classList.contains("is-visible")) return;

  const cell = getCellFromPointer(event);

  if (!cell) {
    hideHoverBadge();
    return;
  }

  const placement = state.cellPlacements[cell.row * state.currentGrid.columns + cell.column];
  const colorText = placement?.empty ? "boş" : placement?.color ?? "-";

  elements.hoverBadge.innerHTML = `x:${cell.column + 1} y:${cell.row + 1}<br>${colorText}`;
  elements.hoverBadge.style.left = `${event.clientX - elements.resultWrap.getBoundingClientRect().left + 12}px`;
  elements.hoverBadge.style.top = `${event.clientY - elements.resultWrap.getBoundingClientRect().top + 12}px`;
  elements.hoverBadge.classList.add("is-visible");
}

function hideHoverBadge() {
  elements.hoverBadge.classList.remove("is-visible");
}

function cycleCellColor(event) {
  if (!state.currentGrid || !state.editPalette.length) return;

  const cell = getCellFromPointer(event);
  if (!cell) return;

  const index = cell.row * state.currentGrid.columns + cell.column;
  const placement = state.cellPlacements[index];
  const currentIndex = placement?.empty
    ? -1
    : state.editPalette.findIndex((color) => rgbToHex(color).toUpperCase() === placement.color);
  const nextColor = state.editPalette[(currentIndex + 1) % state.editPalette.length];
  const nextHex = rgbToHex(nextColor).toUpperCase();

  state.cellPlacements[index] = {
    x: cell.column + 1,
    y: cell.row + 1,
    color: nextHex,
    hex: nextHex,
    empty: false,
  };

  drawEditedCell(cell.column, cell.row, nextHex);
  syncManualEdits();
  updateHoverBadge(event);
}

function getCellFromPointer(event) {
  const rect = elements.resultCanvas.getBoundingClientRect();
  const isInside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  if (!isInside) return null;

  return {
    column: Math.min(
      state.currentGrid.columns - 1,
      Math.max(
        0,
        Math.floor(((event.clientX - rect.left) / rect.width) * state.currentGrid.columns),
      ),
    ),
    row: Math.min(
      state.currentGrid.rows - 1,
      Math.max(
        0,
        Math.floor(((event.clientY - rect.top) / rect.height) * state.currentGrid.rows),
      ),
    ),
  };
}

function drawEditedCell(column, row, hex) {
  const size = state.currentGrid.cellSize;
  resultContext.fillStyle = hex;
  resultContext.fillRect(column * size, row * size, size, size);
}

function syncManualEdits() {
  const colorUsage = buildColorUsageFromPlacements();
  renderPalette(colorUsage.filter((color) => color.count > 0));
  renderPlacementList();
  updateResultMeta(colorUsage.filter((color) => color.count > 0), state.currentGrid);
}

function buildColorUsageFromPlacements() {
  return state.editPalette.map((color) => {
    const hex = rgbToHex(color).toUpperCase();
    const count = state.cellPlacements.filter((cell) => !cell.empty && cell.color === hex).length;

    return {
      ...color,
      count,
    };
  });
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
  state.gridColumns = clampInteger(elements.gridColumns.value, 1, 200);
  state.gridRows = clampInteger(elements.gridRows.value, 1, 200);
  elements.gridColumns.value = String(state.gridColumns);
  elements.gridRows.value = String(state.gridRows);
  elements.blockSize.disabled = state.physicalGridMode;
  elements.blockSize.closest(".free-mode-control").classList.toggle(
    "is-disabled",
    state.physicalGridMode,
  );
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

function getActiveGrid(width, height) {
  if (state.physicalGridMode) {
    return {
      mode: "physical",
      columns: state.gridColumns,
      rows: state.gridRows,
      cellSize: 1,
      outputWidth: state.gridColumns,
      outputHeight: state.gridRows,
    };
  }

  const columns = Math.ceil(width / state.blockSize);
  const rows = Math.ceil(height / state.blockSize);

  return {
    mode: "free",
    columns,
    rows,
    cellSize: state.blockSize,
    outputWidth: columns * state.blockSize,
    outputHeight: rows * state.blockSize,
  };
}

function getSampleBounds(column, row, width, height, grid) {
  if (grid.mode === "physical") {
    const x = Math.floor((column * width) / grid.columns);
    const y = Math.floor((row * height) / grid.rows);
    const nextX = Math.floor(((column + 1) * width) / grid.columns);
    const nextY = Math.floor(((row + 1) * height) / grid.rows);

    return {
      x,
      y,
      width: Math.max(1, Math.min(width - x, nextX - x || 1)),
      height: Math.max(1, Math.min(height - y, nextY - y || 1)),
    };
  }

  const x = column * grid.cellSize;
  const y = row * grid.cellSize;

  return {
    x,
    y,
    width: Math.max(1, Math.min(grid.cellSize, width - x)),
    height: Math.max(1, Math.min(grid.cellSize, height - y)),
  };
}

function formatSize(width, height) {
  return `${width.toLocaleString("tr-TR")} x ${height.toLocaleString("tr-TR")} px`;
}

function clampInteger(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
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
    const gridPart = state.physicalGridMode
      ? `${state.gridColumns}x${state.gridRows}`
      : `${state.blockSize}px`;
    link.download = `${slugify(state.fileName)}-${gridPart}-${state.colorCount}renk.png`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

async function copyPlacementList() {
  if (!state.placementCsv) return;

  try {
    await navigator.clipboard.writeText(state.placementCsv);
    elements.copyListBtn.textContent = "Kopyalandı";
    window.setTimeout(() => {
      elements.copyListBtn.textContent = "Listeyi kopyala";
    }, 1400);
  } catch (error) {
    elements.placementList.select();
    document.execCommand("copy");
  }
}

function downloadPlacementList() {
  if (!state.placementCsv) return;

  const blob = new Blob([state.placementCsv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  const gridPart = state.physicalGridMode
    ? `${state.gridColumns}x${state.gridRows}`
    : `${state.currentGrid?.columns ?? 0}x${state.currentGrid?.rows ?? 0}`;

  link.href = url;
  link.download = `${slugify(state.fileName)}-${gridPart}-koordinatlar.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
