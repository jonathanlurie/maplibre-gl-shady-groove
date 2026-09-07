import type { TerrainEncoding } from "./ShadyGroove";
import type { RGBColor, TileIndex } from "./types";

export type FloatImage = {
  width: number;
  height: number;
  data: Float32Array;
};

const Z_FOR_CENTRAL_MASS: Record<number, number> = {
  0.9: 1.644854,
  0.95: 1.959964,
  0.98: 2.326348,
  0.99: 2.575829,
  0.995: 2.807034,
  0.997: 3.0,
  0.999: 3.290527,
};

export function sigmaFromRadius(
  radius: number,
  centralMass: 0.9 | 0.95 | 0.98 | 0.99 | 0.995 | 0.997 | 0.999 = 0.99,
): number {
  if (radius <= 0) return 1e-6;
  const z = Z_FOR_CENTRAL_MASS[centralMass];
  return radius / z;
}

export function buildGaussianKernelFromRadius(
  radius: number,
  centralMass: 0.9 | 0.95 | 0.98 | 0.99 | 0.995 | 0.997 | 0.999 = 0.99,
): Float32Array {
  const sigma = sigmaFromRadius(radius, centralMass);
  return buildGaussianKernel(radius, sigma);
}

export function buildGaussianKernel(radius: number, sigma: number): Float32Array {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma2 = sigma * sigma * 2;
  let sum = 0;

  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / sigma2);
    kernel[i + radius] = value;
    sum += value;
  }

  // Normalize kernel
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

export function gaussianBlurImageData(input: FloatImage, kernelRadius: number): FloatImage {
  const kernel = buildGaussianKernelFromRadius(kernelRadius);
  const convolvedH = convolve1D(input, kernel, true);
  const convolvedV = convolve1D(convolvedH, kernel, false);
  return convolvedV;
}

export function convolve1D(src: FloatImage, kernel: Float32Array, horizontal: boolean): FloatImage {
  const srcData = src.data;
  const dstData = new Float32Array(srcData.length);
  const width = src.width;
  const height = src.height;
  const radius = Math.floor(kernel.length / 2);

  if (horizontal) {
    // For each row
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let pixVal = 0;

        for (let k = -radius; k <= radius; k++) {
          let sx = x + k;
          if (sx < 0) sx = 0;
          if (sx >= width) sx = width - 1;

          const idx = y * width + sx;
          const w = kernel[k + radius];

          pixVal += srcData[idx] * w;
        }

        const idxOut = y * width + x;
        dstData[idxOut] = pixVal;
      }
    }
  } else {
    // Vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let pixVal = 0;

        for (let k = -radius; k <= radius; k++) {
          let sy = y + k;
          if (sy < 0) sy = 0;
          if (sy >= height) sy = height - 1;

          const idx = sy * width + x;
          const w = kernel[k + radius];
          pixVal += srcData[idx] * w;
        }

        const idxOut = y * width + x;
        dstData[idxOut] = pixVal;
      }
    }
  }

  return {
    width,
    height,
    data: dstData,
  };
}

export async function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      resolve(img);
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = url;
  });
}

export async function loadImgFetch(url: string): Promise<HTMLImageElement | null> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectURL = URL.createObjectURL(blob);

  const img = new Image();

  // Important if you later draw to canvas and want pixel access
  img.crossOrigin = "anonymous";

  return new Promise((resolve) => {
    img.onload = () => {
      URL.revokeObjectURL(objectURL); // clean up
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectURL);
      resolve(null);
    };
    img.src = objectURL;
  });
}

export async function fetchAsImageBitmap(url: string, abortSignal?: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  return imageBitmap;
}

export function makeBlurryCopy(canvas: HTMLCanvasElement, blurSize: number): HTMLCanvasElement {
  const newCanvas = document.createElement("canvas");
  const newCtx = newCanvas.getContext("2d") as CanvasRenderingContext2D;
  newCanvas.width = canvas.width;
  newCanvas.height = canvas.height;
  newCtx.filter = `blur(${blurSize}px)`;
  newCtx.drawImage(canvas, 0, 0);
  return newCanvas;
}

export function getElevationData(canvas: OffscreenCanvas, terrainEncoding: TerrainEncoding): FloatImage {
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  const imgInfo = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgInfo.data;

  const nbPixels = canvas.width * canvas.height;
  const elevationData = new Float32Array(nbPixels);

  for (let i = 0; i < nbPixels; i += 1) {
    if (terrainEncoding === "terrarium") {
      elevationData[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
    }
  }

  return {
    width: canvas.width,
    height: canvas.height,
    data: elevationData,
  };
}

export function computeElevationDelta(eleA: FloatImage, eleB: FloatImage, keepPositiveOnly = false): FloatImage {
  const eleDeltaData = new Float32Array(eleA.data.length);

  for (let i = 0; i < eleDeltaData.length; i += 1) {
    eleDeltaData[i] = eleA.data[i] - eleB.data[i];

    if (keepPositiveOnly && eleDeltaData[i] < 0) {
      eleDeltaData[i] = 0;
    }
  }
  return {
    width: eleA.width,
    height: eleA.height,
    data: eleDeltaData,
  };
}

export function floatImageToCanvas(fImg: FloatImage, color: RGBColor): OffscreenCanvas {
  const canvas = new OffscreenCanvas(fImg.width, fImg.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imgData.data;

  for (let i = 0, n = fImg.data.length; i < n; i += 1) {
    pixels[i * 4] = color[0];
    pixels[i * 4 + 1] = color[1];
    pixels[i * 4 + 2] = color[2];
    pixels[i * 4 + 3] = Math.max(0, Math.min(255, fImg.data[i]));
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function sumFloatImages(allImages: Array<{ fImg: FloatImage; ratio: number }>): FloatImage {
  // TODO: check they all have the same size

  if (allImages.length < 2) {
    throw new Error("Need at least 2 FloatImages");
  }

  const outData = new Float32Array(allImages[0].fImg.data.length);

  for (const element of allImages) {
    const data = element.fImg.data;
    for (let j = 0; j < data.length; j += 1) {
      outData[j] += data[j] * element.ratio;
    }
  }

  return {
    data: outData,
    width: allImages[0].fImg.width,
    height: allImages[0].fImg.height,
  };
}

export function maxFloatImages(allImages: Array<{ fImg: FloatImage; ratio: number }>): FloatImage {
  // TODO: check they all have the same size

  if (allImages.length < 2) {
    throw new Error("Need at least 2 FloatImages");
  }

  const outData = allImages[0].fImg.data.map((v) => v * allImages[0].ratio);

  for (const img of allImages) {
    const data = img.fImg.data;
    const ratio = img.ratio;

    for (let j = 0; j < data.length; j += 1) {
      outData[j] = Math.max(data[j] * ratio, outData[j]);

      if (j === 0) {
        console.log(outData[j]);
      }
    }
  }

  return {
    data: outData,
    width: allImages[0].fImg.width,
    height: allImages[0].fImg.height,
  };
}

export type FloatImageFilter = (v: number) => number;

export function filterFloatImage(fImg: FloatImage, filter: FloatImageFilter): FloatImage {
  const data = new Float32Array(fImg.data.length);

  for (let i = 0; i < data.length; i += 1) {
    data[i] = filter(fImg.data[i]);
  }

  return {
    data,
    width: fImg.width,
    height: fImg.height,
  };
}

export function makeEaseOutSineFilter(maxValue: number, scale: number): FloatImageFilter {
  return (value: number) => {
    return Math.sin(((Math.min(value, maxValue) / maxValue) * Math.PI) / 2) * scale;
  };
}

export function makeLinearFilter(maxValue: number, scale: number): FloatImageFilter {
  return (value: number) => {
    return (Math.min(value, maxValue) / maxValue) * scale;
  };
}

export function makeEaseOutQuadFilter(maxValue: number, scale: number): FloatImageFilter {
  return (value: number) => {
    const input = Math.min(value, maxValue) / maxValue;
    return (1 - (1 - input) * (1 - input)) * scale;
  };
}

export function makeEaseOutCubicFilter(maxValue: number, scale: number): FloatImageFilter {
  return (value: number) => {
    const input = 1 - (1 - Math.min(value, maxValue) / maxValue) ** 3;
    return input * scale;
  };
}

export function makeEaseInOutSineFilter(maxValue: number, scale: number): FloatImageFilter {
  return (value: number) => {
    const input = Math.min(value, maxValue) / maxValue;
    return (-(Math.cos(Math.PI * input) - 1) / 2) * scale;
  };
}

export function wrapTileIndex(tileIndex: TileIndex): TileIndex {
  const nbTilePerAxis = 2 ** tileIndex.z;
  let x = tileIndex.x % nbTilePerAxis;
  if (x < 0) {
    x = nbTilePerAxis + x;
  }
  return {
    x: x,
    y: tileIndex.y,
    z: tileIndex.z,
  } as TileIndex;
}

export type TileDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export function getNeighborIndex(tileIndex: TileIndex, direction: TileDirection): TileIndex {
  switch (direction) {
    case "N":
      return { z: tileIndex.z, x: tileIndex.x, y: tileIndex.y - 1 };
    case "NE":
      return { z: tileIndex.z, x: tileIndex.x + 1, y: tileIndex.y - 1 };
    case "E":
      return { z: tileIndex.z, x: tileIndex.x + 1, y: tileIndex.y };
    case "SE":
      return { z: tileIndex.z, x: tileIndex.x + 1, y: tileIndex.y + 1 };
    case "S":
      return { z: tileIndex.z, x: tileIndex.x, y: tileIndex.y + 1 };
    case "SW":
      return { z: tileIndex.z, x: tileIndex.x - 1, y: tileIndex.y + 1 };
    case "W":
      return { z: tileIndex.z, x: tileIndex.x - 1, y: tileIndex.y };
    case "NW":
      return { z: tileIndex.z, x: tileIndex.x - 1, y: tileIndex.y - 1 };
  }
}

/**
 * The mosaic is an array with the following order:
 * - center tile
 * - north
 * - north-east
 * - east
 * - south-east
 * - south
 * - south-west
 * - west
 * - north-west
 *
 * The padding is the size in number of pixels that is kept on the edges of the image, centered
 * on the center tile
 */
export function createPaddedTileOffscreenCanvas(mosaic: Array<ImageBitmap | null>, padding = 30) {
  const centerTile = mosaic[0];

  if (!centerTile) {
    throw new Error("The center tile must be non-null");
  }

  // tile size (square)
  const ts = centerTile.width;

  if (padding < 0 || padding > ts) {
    throw new Error("The padding cannot be lower than 0 or greater than the tile size.");
  }

  const finalSize = ts + 2 * padding;
  const canvas = new OffscreenCanvas(finalSize, finalSize);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Non existing canas context");
  }

  // center
  if (mosaic[0]) {
    const img = mosaic[0];
    ctx.drawImage(
      img,
      0,
      0,
      ts,
      ts, // source rectangle (in ImageBitmap space)
      padding,
      padding,
      ts,
      ts, // destination rectangle (in canvas space)
    );
  }

  // north
  if (mosaic[1]) {
    const img = mosaic[1];
    ctx.drawImage(
      img,
      0,
      ts - padding - 1,
      ts,
      padding, // source rectangle (in ImageBitmap space)
      padding,
      0,
      ts,
      padding, // destination rectangle (in canvas space)
    );
  }

  // north-east
  if (mosaic[2]) {
    const img = mosaic[2];
    ctx.drawImage(
      img,
      0,
      ts - padding - 1,
      padding,
      padding, // source rectangle (in ImageBitmap space)
      padding + ts,
      0,
      padding,
      padding, // destination rectangle (in canvas space)
    );
  }

  // east
  if (mosaic[3]) {
    const img = mosaic[3];
    ctx.drawImage(
      img,
      0,
      0,
      padding,
      ts, // source rectangle (in ImageBitmap space)
      padding + ts,
      padding,
      padding,
      ts, // destination rectangle (in canvas space)
    );
  }

  // south-east
  if (mosaic[4]) {
    const img = mosaic[4];
    ctx.drawImage(
      img,
      0,
      0,
      padding,
      padding, // source rectangle (in ImageBitmap space)
      padding + ts,
      padding + ts,
      padding,
      padding, // destination rectangle (in canvas space)
    );
  }

  // south
  if (mosaic[5]) {
    const img = mosaic[5];
    ctx.drawImage(
      img,
      0,
      0,
      ts,
      padding, // source rectangle (in ImageBitmap space)
      padding,
      padding + ts,
      ts,
      padding, // destination rectangle (in canvas space)
    );
  }

  // south-west
  if (mosaic[6]) {
    const img = mosaic[6];
    ctx.drawImage(
      img,
      ts - padding - 1,
      0,
      padding,
      padding, // source rectangle (in ImageBitmap space)
      0,
      ts + padding,
      padding,
      padding, // destination rectangle (in canvas space)
    );
  }

  // west
  if (mosaic[7]) {
    const img = mosaic[7];
    ctx.drawImage(
      img,
      ts - padding - 1,
      0,
      padding,
      ts, // source rectangle (in ImageBitmap space)
      0,
      padding,
      padding,
      ts, // destination rectangle (in canvas space)
    );
  }

  // north-west
  if (mosaic[8]) {
    const img = mosaic[8];
    ctx.drawImage(
      img,
      ts - padding - 1,
      ts - padding - 1,
      padding,
      padding, // source rectangle (in ImageBitmap space)
      0,
      0,
      padding,
      padding, // destination rectangle (in canvas space)
    );
  }

  return canvas;
}

export async function trimPaddedTile(
  inputCanvas: OffscreenCanvas | HTMLCanvasElement,
  tileSize: number,
  padding: number,
): Promise<ImageBitmap> {
  return await createImageBitmap(inputCanvas, padding, padding, tileSize, tileSize);
}

export function imageBitmapToOffscreenCanvas(imageBitmap: ImageBitmap): OffscreenCanvas {
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(imageBitmap, 0, 0);
  return canvas;
}

export function imageBitmapToCanvas(imageBitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  // imageBitmap is assumed to exist
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;

  ctx.drawImage(imageBitmap, 0, 0);
  return canvas;
}

export function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}
