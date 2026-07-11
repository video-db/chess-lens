/**
 * board-detector.ts
 *
 * Deterministic chess board isolation via 1D edge projection profiling
 * with unilateral edge-anchor expansion and center-square fallback.
 *
 * Pipeline:
 *   1. Convert RGBA → grayscale luminance.
 *   2. Local variance filter — zero high-texture (noisy background) pixels
 *      while preserving solid-color regions (any chess-theme square color).
 *   3. Simple horizontal + vertical gradient (fast, no full Sobel).
 *   4. Adaptive threshold → binary edge map.
 *   5. Project edge pixels onto X and Y axes.
 *   6. Extract board extents from the X/Y projections via noise-floor
 *      thresholding.  When the X-axis is occluded by a side panel (e.g.
 *      evaluation bar, move list), anchor to the pristine edge and project
 *      the true board height outward — never trust the damaged edge or a
 *      false center.
 *   7. If the projections reveal no meaningful structure, fall back to the
 *      largest centered square — handles full-screen chess streams.
 *   8. Add proportional padding around the detected board square.
 *
 * Runs on a heavily downsampled image (80 px wide) so the whole pass
 * completes in <1 ms and never blocks the event loop.
 */

import { logger } from '../logger';
import { detectChessBoardML } from './board-detector-ml';

export interface BoardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert one RGBA pixel (0-255 per channel) to luminance.
 */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Return the largest possible square centred in the given image dimensions.
 * Used as a safe fallback when edge detection fails to locate the board.
 */
function getCenterSquareFallback(width: number, height: number): BoardBounds {
  const size = Math.min(width, height);
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);

  logger.debug(
    { fallbackSize: size, width, height },
    '[ChessScreenshot] 1D projection found no structure — applying center-square fallback',
  );

  return { x: left, y: top, width: size, height: size };
}

/**
 * Detect a chess board in a raw RGBA bitmap.
 *
 * @param bitmap  Raw RGBA pixel data (4 bytes per pixel).
 * @param width   Width in pixels.
 * @param height  Height in pixels.
 * @returns       Detected board bounds in the same coordinate space.
 *                Always returns a valid BoardBounds — will fall back to a
 *                centered square when the board cannot be visually isolated.
 */
export async function detectChessBoard(
  bitmap: Buffer,
  width: number,
  height: number,
): Promise<BoardBounds> {
  const mlBounds = await detectChessBoardML(bitmap, width, height);
  if (mlBounds !== null) return mlBounds;
  const totalPixels = width * height;

  // ── Step 1: Grayscale ────────────────────────────────────────────────
  const gray = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    gray[i] = luminance(bitmap[off], bitmap[off + 1], bitmap[off + 2]);
  }

  // ── Step 2: Local variance filter ──────────────────────────────────
  // Kill high-texture pixels (background noise) while preserving solid
  // color regions (any chess-theme square color).
  //
  // Uses max-min difference over a 3×3 neighborhood — mathematically
  // cheap (no multiplications, no sqrt, no std-dev).
  //
  // Threshold: a pixel whose 3×3 max-min ≥ 20 is treated as "noisy
  // background" and zeroed.  Chess squares (cream, green, yellow
  // highlight, red check) are all flat fills that stay well below this.
  const VARIANCE_THRESHOLD = 20;
  const filtered = new Float32Array(totalPixels);
  for (let y = 0; y < height; y++) {
    const yMin = Math.max(0, y - 1);
    const yMax = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xMin = Math.max(0, x - 1);
      const xMax = Math.min(width - 1, x + 1);

      let minVal = gray[y * width + x];
      let maxVal = minVal;
      for (let ny = yMin; ny <= yMax; ny++) {
        const rowBase = ny * width;
        for (let nx = xMin; nx <= xMax; nx++) {
          const v = gray[rowBase + nx];
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
      }

      filtered[y * width + x] = (maxVal - minVal) >= VARIANCE_THRESHOLD ? 0 : gray[y * width + x];
    }
  }

  // ── Step 3: Gradient magnitude (max of horizontal & vertical diff) ──
  // Use simple pixel difference instead of full Sobel (4 reads vs 8,
  // no multiplications) — fast enough for the detection task.
  // Reads from the variance-filtered buffer so only board edges survive.
  const edgeMag = new Float32Array(totalPixels);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = Math.abs(filtered[idx + 1] - filtered[idx - 1]);
      const gy = Math.abs(filtered[idx + width] - filtered[idx - width]);
      edgeMag[idx] = gx > gy ? gx : gy;
    }
  }

  // ── Step 4: Adaptive binarisation (mean-based) ─────────────────────
  // Skip the expensive Otsu computation; mean-of-magnitudes plus a
  // sensitivity floor works well for the high-contrast board domain.
  let sumMag = 0;
  let countMag = 0;
  for (let i = 0; i < totalPixels; i++) {
    const m = edgeMag[i];
    if (m > 0) { sumMag += m; countMag++; }
  }
  const meanMag = countMag > 0 ? sumMag / countMag : 0;
  // Floor: at least 8 intensity steps (out of 255) so very low-contrast
  // screens (video stream, blank desktop) are correctly treated as
  // "no board".
  const threshold = Math.max(meanMag * 0.5, 8);

  const binary = new Uint8Array(totalPixels);
  let edgeCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (edgeMag[i] >= threshold) {
      binary[i] = 1;
      edgeCount++;
    }
  }

  // ── Step 4b: Centre-square fallback when the frame is too clean ────
  const edgeRatio = edgeCount / totalPixels;
  if (edgeRatio < 0.01) {
    return getCenterSquareFallback(width, height);
  }

  // ── Step 5: Edge projection profiles ───────────────────────────────
  const rowSums = new Uint16Array(height);
  const colSums = new Uint16Array(width);
  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    let rs = 0;
    for (let x = 0; x < width; x++) {
      if (binary[rowBase + x]) {
        rs++;
        colSums[x]++;
      }
    }
    rowSums[y] = rs;
  }

  // ── Step 5b: Smooth projections (3-point box filter) ──────────────
  const smoothRow = new Float32Array(height);
  const smoothCol = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    let sum = 0; let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy >= 0 && yy < height) { sum += rowSums[yy]; n++; }
    }
    smoothRow[y] = sum / n;
  }
  for (let x = 0; x < width; x++) {
    let sum = 0; let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < width) { sum += colSums[xx]; n++; }
    }
    smoothCol[x] = sum / n;
  }

  // ── Step 5c: Extract board extents from projection profiles ────────
  // Y-axis: vertical extents are reliable because UI overlays (clocks,
  // player names) are horizontal strips.  X-axis: a side panel (eval bar,
  // move list) may occlude one side — handled in Step 6.
  let maxRowVal = 0;
  for (let y = 0; y < height; y++) {
    if (smoothRow[y] > maxRowVal) maxRowVal = smoothRow[y];
  }
  // Use 25 % of the peak (not 10 %) so low-amplitude text/clock bands
  // are excluded from the vertical extents.
  const rowNoiseFloor = Math.max(maxRowVal * 0.25, 2);
  let topY = 0;
  let bottomY = height - 1;
  for (let y = 0; y < height; y++) {
    if (smoothRow[y] > rowNoiseFloor) { topY = y; break; }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (smoothRow[y] > rowNoiseFloor) { bottomY = y; break; }
  }
  const trueBoardSize = bottomY - topY;

  let maxColVal = 0;
  for (let x = 0; x < width; x++) {
    if (smoothCol[x] > maxColVal) maxColVal = smoothCol[x];
  }
  const colNoiseFloor = Math.max(maxColVal * 0.25, 2);
  let leftX = 0;
  let rightX = width - 1;
  for (let x = 0; x < width; x++) {
    if (smoothCol[x] > colNoiseFloor) { leftX = x; break; }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (smoothCol[x] > colNoiseFloor) { rightX = x; break; }
  }
  const boardWidth = rightX - leftX;

  // ── Step 4b again: if both axes are empty, fall back ─────────────
  if (trueBoardSize === 0 || boardWidth === 0) {
    return getCenterSquareFallback(width, height);
  }

  // ── Step 6: Unilateral edge anchor ───────────────────────────────
  // A chess board is always 1:1.  When the X-axis projection returns a
  // width significantly smaller than the true height, one side is occluded
  // (e.g. right-side eval bar, left-side chat panel).
  // Instead of computing a false center, anchor to the pristine edge and
  // project the full height away from it, completely ignoring the damaged edge.
  let squareLeft: number;
  let squareSize: number;
  const squareTop = topY;

  if (trueBoardSize > 0 && boardWidth < trueBoardSize * 0.9) {
    const leftMargin = leftX;
    const rightMargin = width - rightX;

    if (leftMargin <= rightMargin) {
      // Left edge is pristine — anchor left, expand right.
      squareLeft = leftX;
    } else {
      // Right edge is pristine — anchor right, expand left.
      squareLeft = Math.max(0, rightX - trueBoardSize);
    }
    squareSize = trueBoardSize;
  } else {
    // No significant occlusion — trust the 1D boundaries directly.
    squareLeft = leftX;
    squareSize = boardWidth;
  }

  // ── Step 7: Add 1/8 proportional padding around the board square ─
  const padX = Math.max(1, Math.round(squareSize / 8));
  const padY = Math.max(1, Math.round(squareSize / 8));

  let rx = squareLeft;
  let ry = squareTop;
  let rw = squareSize;
  let rh = squareSize;

  rx -= padX;
  ry -= padY;
  rw += 2 * padX;
  rh += 2 * padY;

  // Clamp to screen boundaries, shrinking the padded box if it overhangs.
  if (rx < 0) { rw += rx; rx = 0; }
  if (ry < 0) { rh += ry; ry = 0; }
  if (rx + rw > width)  { rw = width - rx; }
  if (ry + rh > height) { rh = height - ry; }

  return { x: rx, y: ry, width: rw, height: rh };
}
