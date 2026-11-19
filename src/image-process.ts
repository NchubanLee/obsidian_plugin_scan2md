import jpeg from "jpeg-js";

/** 一张 RGBA 位图（每像素 4 字节）。 */
export interface PixelImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** 解码 JPEG Buffer → RGBA 位图。 */
export function decodeJpeg(buf: Buffer): PixelImage {
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { data: raw.data, width: raw.width, height: raw.height };
}

/** 编码 RGBA 位图 → JPEG（返回全新 ArrayBuffer，便于直接写入 Vault 附件）。 */
export function encodeJpeg(img: PixelImage, quality = 0.92): ArrayBuffer {
  const out = jpeg.encode(
    { data: Buffer.from(img.data), width: img.width, height: img.height },
    Math.round(quality * 100)
  );
  const ab = new ArrayBuffer(out.data.byteLength);
  new Uint8Array(ab).set(out.data);
  return ab;
}

/** 裁切一个矩形区域（坐标/尺寸先取整并夹取到图内）。 */
export function crop(
  img: PixelImage,
  x: number,
  y: number,
  w: number,
  h: number
): PixelImage {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w));
  const y1 = Math.min(img.height, Math.round(y + h));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) throw new Error("裁切区域无效");
  const data = new Uint8Array(cw * ch * 4);
  for (let yy = 0; yy < ch; yy++) {
    const src = ((y0 + yy) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + cw * 4), yy * cw * 4);
  }
  return { data, width: cw, height: ch };
}

/** 缩放到灰度图（用于估算倾斜角，不放大）。 */
function grayscaleDownscaled(
  img: PixelImage,
  maxDim = 400
): { gray: Float32Array; w: number; h: number } {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * scale));
  const h = Math.max(2, Math.round(img.height * scale));
  const gray = new Float32Array(w * h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const py = Math.min(img.height - 1, Math.floor(y * sy));
    for (let x = 0; x < w; x++) {
      const px = Math.min(img.width - 1, Math.floor(x * sx));
      const i = (py * img.width + px) * 4;
      gray[y * w + x] =
        0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    }
  }
  return { gray, w, h };
}

/**
 * 行投影方差：把灰度图按 theta（顺时针为正）旋转后，统计每一行的均值，
 * 再求这些行均值之间的方差。文字/线条与行对齐时方差最大。
 */
function projectionVariance(
  gray: Float32Array,
  w: number,
  h: number,
  theta: number
): number {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cx = w / 2;
  const cy = h / 2;
  const sum = new Float64Array(h);
  const cnt = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const nx = cx + dx * cos - dy * sin;
      const ny = cy + dx * sin + dy * cos;
      const ix = Math.round(nx);
      const iy = Math.round(ny);
      if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
        sum[iy] += gray[y * w + x];
        cnt[iy]++;
      }
    }
  }
  let total = 0;
  let n = 0;
  const means = new Float64Array(h);
  for (let i = 0; i < h; i++) {
    if (cnt[i] > 0) {
      means[i] = sum[i] / cnt[i];
      total += means[i];
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = total / n;
  let variance = 0;
  for (let i = 0; i < h; i++) {
    if (cnt[i] > 0) {
      const d = means[i] - mean;
      variance += d * d;
    }
  }
  return variance / n;
}

/**
 * 估算倾斜角（弧度，顺时针为正）。在 -6°~+6° 内搜索使行投影方差最大的角度，
 * 返回该“需要应用”的旋转角。返回 0 表示基本无倾斜。
 */
export function detectSkewRad(img: PixelImage): number {
  const { gray, w, h } = grayscaleDownscaled(img);
  let best = 0;
  let bestScore = -Infinity;
  for (let deg = -6; deg <= 6.0001; deg += 0.5) {
    const rad = (deg * Math.PI) / 180;
    const score = projectionVariance(gray, w, h, rad);
    if (score > bestScore) {
      bestScore = score;
      best = rad;
    }
  }
  // 小于约 0.3° 视为无倾斜，避免噪声导致的过度旋转
  return Math.abs(best) < (0.3 * Math.PI) / 180 ? 0 : best;
}

/** 双线性采样（只取 RGB 三通道；越界返回 255 白）。 */
function sampleBilinear(
  img: PixelImage,
  x: number,
  y: number,
  c: number
): number {
  const w = img.width;
  const h = img.height;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const v00 = img.data[(y0 * w + x0) * 4 + c];
  const v10 = img.data[(y0 * w + x1) * 4 + c];
  const v01 = img.data[(y1 * w + x0) * 4 + c];
  const v11 = img.data[(y1 * w + x1) * 4 + c];
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}

/** 顺时针旋转 theta 弧度（白底、同尺寸、双线性）。 */
export function rotate(img: PixelImage, theta: number): PixelImage {
  const w = img.width;
  const h = img.height;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cx = w / 2;
  const cy = h / 2;
  const data = new Uint8Array(w * h * 4);
  data.fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = cx + dx * cos + dy * sin; // 反向旋转采样
      const sy = cy - dx * sin + dy * cos;
      if (sx >= 0 && sx <= w - 1 && sy >= 0 && sy <= h - 1) {
        const di = (y * w + x) * 4;
        data[di] = sampleBilinear(img, sx, sy, 0);
        data[di + 1] = sampleBilinear(img, sx, sy, 1);
        data[di + 2] = sampleBilinear(img, sx, sy, 2);
        data[di + 3] = 255;
      }
    }
  }
  return { data, width: w, height: h };
}

/** USM 锐化：out = in + amount * (in - blur3x3)。 */
export function sharpen(img: PixelImage, amount = 1.0): PixelImage {
  const w = img.width;
  const h = img.height;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              sum += img.data[(ny * w + nx) * 4 + c];
              n++;
            }
          }
        }
        const orig = img.data[di + c];
        const blurred = sum / n;
        const v = orig + amount * (orig - blurred);
        data[di + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      data[di + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** 图例增强：先拉正角度，再锐化。 */
export function enhance(img: PixelImage): PixelImage {
  const angle = detectSkewRad(img);
  const straightened = angle === 0 ? img : rotate(img, angle);
  return sharpen(straightened, 1.0);
}

