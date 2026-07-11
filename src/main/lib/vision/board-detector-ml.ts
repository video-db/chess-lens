import * as ort from 'onnxruntime-node';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';

const log = logger.child({ module: 'board-detector-ml' });

export interface BoardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MODEL_FILENAME = 'chessboard-detection.onnx';
const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.25;
const NMS_IOU_THRESHOLD = 0.5;

let sessionPromise: Promise<ort.InferenceSession | null> | null = null;

function getModelPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'models', MODEL_FILENAME);
  }
  return path.resolve(__dirname, '..', '..', '..', 'assets', 'models', MODEL_FILENAME);
}

function initSession(): Promise<ort.InferenceSession | null> {
  const modelPath = getModelPath();
  if (!fs.existsSync(modelPath)) {
    log.warn({ modelPath }, '[BoardDetectorML] ONNX model not found — ML detection unavailable');
    return Promise.resolve(null);
  }
  log.info({ modelPath }, '[BoardDetectorML] Loading ONNX model...');
  return ort.InferenceSession.create(modelPath, {}).then((sess) => {
    log.info('[BoardDetectorML] ONNX session created');
    return sess;
  }).catch((err) => {
    log.error({ err }, '[BoardDetectorML] Failed to create ONNX session');
    return null;
  });
}

function getSession(): Promise<ort.InferenceSession | null> {
  if (!sessionPromise) {
    sessionPromise = initSession();
  }
  return sessionPromise;
}

function bilinearResize(
  src: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Buffer {
  const dst = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const srcY = dy * yRatio;
    const y0 = Math.min(Math.floor(srcY), srcH - 2);
    const y1 = y0 + 1;
    const yFrac = srcY - y0;

    for (let dx = 0; dx < dstW; dx++) {
      const srcX = dx * xRatio;
      const x0 = Math.min(Math.floor(srcX), srcW - 2);
      const x1 = x0 + 1;
      const xFrac = srcX - x0;

      const dstIdx = (dy * dstW + dx) * 4;

      for (let c = 0; c < 4; c++) {
        const tl = src[(y0 * srcW + x0) * 4 + c];
        const tr = src[(y0 * srcW + x1) * 4 + c];
        const bl = src[(y1 * srcW + x0) * 4 + c];
        const br = src[(y1 * srcW + x1) * 4 + c];

        const top = tl + (tr - tl) * xFrac;
        const bot = bl + (br - bl) * xFrac;
        dst[dstIdx + c] = Math.round(top + (bot - top) * yFrac);
      }
    }
  }

  return dst;
}

function rgbaToCHW(rgba: Buffer): Float32Array {
  const totalPixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    tensor[i] = rgba[off] / 255;
    tensor[totalPixels + i] = rgba[off + 1] / 255;
    tensor[2 * totalPixels + i] = rgba[off + 2] / 255;
  }

  return tensor;
}

interface Detection {
  cx: number;
  cy: number;
  w: number;
  h: number;
  confidence: number;
}

function iou(a: Detection, b: Detection): number {
  const ax1 = a.cx - a.w / 2;
  const ay1 = a.cy - a.h / 2;
  const ax2 = a.cx + a.w / 2;
  const ay2 = a.cy + a.h / 2;

  const bx1 = b.cx - b.w / 2;
  const by1 = b.cy - b.h / 2;
  const bx2 = b.cx + b.w / 2;
  const by2 = b.cy + b.h / 2;

  const x1 = Math.max(ax1, bx1);
  const y1 = Math.max(ay1, by1);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (ax2 - ax1) * (ay2 - ay1);
  const areaB = (bx2 - bx1) * (by2 - ay1);

  return inter / (areaA + areaB - inter + 1e-8);
}

function nms(detections: Detection[], iouThreshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const result: Detection[] = [];

  for (let i = 0; i < sorted.length; i++) {
    let keep = true;
    for (const kept of result) {
      if (iou(kept, sorted[i]) > iouThreshold) {
        keep = false;
        break;
      }
    }
    if (keep) result.push(sorted[i]);
  }

  return result;
}

export async function detectChessBoardML(
  bitmap: Buffer,
  width: number,
  height: number,
): Promise<BoardBounds | null> {
  const session = await getSession();
  if (!session) return null;

  const resized = bilinearResize(bitmap, width, height, INPUT_SIZE, INPUT_SIZE);
  const inputTensor = rgbaToCHW(resized);

  const feeds: Record<string, ort.Tensor> = {
    images: new ort.Tensor('float32', inputTensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  };

  let results: ort.InferenceSession.ReturnType;
  try {
    results = await session.run(feeds);
  } catch (err) {
    log.error({ err }, '[BoardDetectorML] ONNX inference failed');
    return null;
  }

  const outputName = session.outputNames[0];
  const output = results[outputName];
  const data = output.data as Float32Array;

  const numDetections = 8400;
  const detections: Detection[] = [];

  for (let i = 0; i < numDetections; i++) {
    const confidence = data[i + 4 * numDetections];
    if (confidence < CONFIDENCE_THRESHOLD) continue;

    const cx = data[i];
    const cy = data[i + numDetections];
    const w = data[i + 2 * numDetections];
    const h = data[i + 3 * numDetections];

    detections.push({ cx, cy, w, h, confidence });
  }

  if (detections.length === 0) return null;

  const kept = nms(detections, NMS_IOU_THRESHOLD);
  if (kept.length === 0) return null;

  const best = kept[0];

  const scaleX = width / INPUT_SIZE;
  const scaleY = height / INPUT_SIZE;

  let x = Math.round((best.cx - best.w / 2) * scaleX);
  let y = Math.round((best.cy - best.h / 2) * scaleY);
  let bw = Math.round(best.w * scaleX);
  let bh = Math.round(best.h * scaleY);

  const size = Math.max(bw, bh);
  bw = size;
  bh = size;

  const padX = Math.max(1, Math.round(bw / 8));
  const padY = Math.max(1, Math.round(bh / 8));
  x -= padX;
  y -= padY;
  bw += 2 * padX;
  bh += 2 * padY;

  if (x < 0) { bw += x; x = 0; }
  if (y < 0) { bh += y; y = 0; }
  if (x + bw > width) { bw = width - x; }
  if (y + bh > height) { bh = height - y; }

  log.debug(
    { bounds: { x, y, width: bw, height: bh }, confidence: best.confidence },
    '[BoardDetectorML] Board detected',
  );

  return { x, y, width: bw, height: bh };
}
