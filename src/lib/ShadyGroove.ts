import type { AddProtocolAction, Map as MLMap, RequestParameters } from "maplibre-gl";
import { ProcessingNode, RasterContext, Texture, UNIFORM_TYPE } from "raster-gl";
import {
  defaultGaussianScaleSpaceWeights,
  type GaussianScaleSpaceWeights,
  type GaussianScaleSpaceWeightsPerZoomLevel,
} from "./gaussianScaleSpaceWeights";
import { TileCache } from "./TileCache";
import TileWorker from "./tile-worker?worker&inline";
import { buildGaussianKernelFromRadius, clamp, createPaddedTileOffscreenCanvas, getNeighborIndex } from "./tools";
import type { RGBColor, TileIndex } from "./types";

export type TerrainEncoding = "terrarium" | "mapbox";

const terrariumToElevation = `
// Decoding Terrarium encoding
float terrariumToElevation(vec4 color) {
  return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
}
`.trim();

const elevationToTerrarium = `
// Encoding elevation to Terrarium
vec4 elevationToTerrarium(float elevation) {
  float e = elevation + 32768.0;
  float r = floor(e / 256.0);
  float g = floor(e - r * 256.0);
  float b = (e - r * 256.0 - g) * 256.0;
  return vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
`.trim();

const fragmentShaderBlurPass = `
#version 300 es
precision highp float;

const int MAX_KERNEL_SIZE = 121;

in vec2 uv;
out vec4 fragColor;

uniform float u_kernel[MAX_KERNEL_SIZE];
uniform int u_kernelSize;
uniform sampler2D u_tile;
uniform bool u_isHorizontalPass;

${terrariumToElevation}

${elevationToTerrarium}

void main() {
  // Getting texture coordinate in integer
  // ivec2 pixelCoord = ivec2(gl_FragCoord.xy);
  // vec4 color = texelFetch(u_tile, pixelCoord, 0);  // 0 = mip level

  // Size of the texture in number of pixels
  vec2 textureSize = vec2(textureSize(u_tile, 0));

  float unitHorizontalStep = 1. / textureSize.x;
  float unitVerticalStep = 1. / textureSize.y;

  float sum = 0.0;
  vec2 neighborPosition = vec2(uv);
  int halfKernelSize = u_kernelSize / 2;

  for (int i = 0; i < u_kernelSize; i++) {
    if(u_isHorizontalPass) {
      neighborPosition.x = uv.x + float(i - halfKernelSize) * unitHorizontalStep;
    } else {
      neighborPosition.y = uv.y + float(i - halfKernelSize) * unitVerticalStep; 
    }
      
    vec4 color = texture(u_tile, neighborPosition);
    float elevation = terrariumToElevation(color);
    sum += u_kernel[i] * elevation;
  }

  fragColor = elevationToTerrarium(sum);
}
`.trim();

const fragmentShaderCombine = `
#version 300 es
precision highp float;

#define PI 3.141592653589793

in vec2 uv;
out vec4 fragColor;

uniform vec3 u_tint;

uniform float u_alpha;
uniform float u_weightLowPass_3;
uniform float u_weightLowPass_7;
uniform float u_weightLowPass_15;
uniform float u_weightLowPass_30;
uniform float u_weightLowPass_60;

uniform sampler2D u_tile;
uniform sampler2D u_tileLowPass_3;
uniform sampler2D u_tileLowPass_7;
uniform sampler2D u_tileLowPass_15;
uniform sampler2D u_tileLowPass_30;
uniform sampler2D u_tileLowPass_60;

${terrariumToElevation}


float easeOutSine(float value, float maxValue, float scale) {
  return sin(((min(value, maxValue) / maxValue) * PI) / 2.) * scale;
}


void main() {
  float eleTile = terrariumToElevation(texture(u_tile, uv));
  float eleTileLowPass3 = terrariumToElevation(texture(u_tileLowPass_3, uv));
  float eleTileLowPass7 = terrariumToElevation(texture(u_tileLowPass_7, uv));
  float eleTileLowPass15 = terrariumToElevation(texture(u_tileLowPass_15, uv));
  float eleTileLowPass30 = terrariumToElevation(texture(u_tileLowPass_30, uv));
  float eleTileLowPass60 = terrariumToElevation(texture(u_tileLowPass_60, uv));

  float eleDeltaLowPass3 = max(0., eleTileLowPass3 - eleTile);
  float eleDeltaLowPass7 = max(0., eleTileLowPass7 - eleTile);
  float eleDeltaLowPass15 = max(0., eleTileLowPass15 - eleTile);
  float eleDeltaLowPass30 = max(0., eleTileLowPass30 - eleTile);
  float eleDeltaLowPass60 = max(0., eleTileLowPass60 - eleTile);

  float multiresWeightedDelta = (eleDeltaLowPass3 * u_weightLowPass_3)
    + (eleDeltaLowPass7 * u_weightLowPass_7)
    + (eleDeltaLowPass15 * u_weightLowPass_15)
    + (eleDeltaLowPass30 * u_weightLowPass_30)
    + (eleDeltaLowPass60 * u_weightLowPass_60);

  float easedValue = easeOutSine(multiresWeightedDelta, 2000., 1.);
  fragColor = vec4(u_tint.r, u_tint.g, u_tint.b, easedValue);
  fragColor.a *= u_alpha;
}
`.trim();

// Options for web worker when computation is on CPU
export type TileProcesingWorkerMessage = {
  tileIndex: TileIndex;
  paddedTile: ImageBitmap;
  padding: number;
  terrainEncoding: TerrainEncoding;
  gaussianScaleSpaceWeights: GaussianScaleSpaceWeights;
  color: RGBColor;
  tileSize: number;
};

export type CustomTileImageBitmapMaker = (
  tileIndex: TileIndex,
  abortSignal?: AbortSignal,
) => Promise<ImageBitmap | null>;

export type ShadyGrooveOptions = {
  /**
   * A URL pattern such as "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"
   * Alternatively, the option customTileImageBitmapMaker is a way to
   * source tiles from a custom source, such as a PMTiles file.
   * If both are provided, the option `urlPattern` prevails overs `customTileImageBitmapMaker`.
   */
  urlPattern?: string;

  /**
   * A custom function to source raster terrain tile as ImageBitmap.
   * If bother are provided, the option `urlPattern` prevails overs `customTileImageBitmapMaker`.
   */
  customTileImageBitmapMaker?: CustomTileImageBitmapMaker;

  /**
   * Terrain encoding: "mapbox" or "terrarium"
   */
  terrainEncoding: TerrainEncoding;

  /**
   * Custom weights of each gaussian scale on each zoom levels.
   * Default: using the built-in
   */
  gaussianScaleSpaceWeights?: GaussianScaleSpaceWeightsPerZoomLevel;

  /**
   * Color of the shade as RGB with values in [0, 255]
   * Default:
   */
  color?: RGBColor;

  /**
   * Opacity of the layer in [0, 1]
   */
  alpha?: number;

  /**
   * Min zoom level.
   * Default: 0
   */
  minzoom?: number;

  /**
   * Max zoom level.
   * Default: 12
   */
  maxzoom?: number;
};

/**
 * Gaussian Scale-space Terrain Shading
 */
export class ShadyGroove {
  private readonly urlPattern: string | null = null;
  private readonly customTileImageBitmapMaker: CustomTileImageBitmapMaker | null = null;
  private readonly tileCache = new TileCache();
  private readonly padding = 60;
  private readonly terrainEncoding: TerrainEncoding;
  private readonly gaussianScaleSpaceWeights: GaussianScaleSpaceWeightsPerZoomLevel;
  private readonly color: RGBColor;
  private rctx!: RasterContext;
  private lowPassHorizontalNode!: ProcessingNode;
  private lowPassVerticalNode!: ProcessingNode;
  private combineNode!: ProcessingNode;
  private readonly minzoom: number;
  private readonly maxzoom: number;
  private readonly alpha: number;
  private readonly sourceId = `sg_source-${Math.random().toFixed(6).split(".").pop()}`;
  private readonly layerId = `sg_layer-${Math.random().toFixed(6).split(".").pop()}`;
  private readonly protocolName = `shadygroove-${Math.random().toFixed(6).split(".").pop()}`;
  private map: MLMap | null = null;

  constructor(options: ShadyGrooveOptions) {
    this.urlPattern = options.urlPattern ?? null;
    this.customTileImageBitmapMaker = options.customTileImageBitmapMaker ?? null;

    if (!this.urlPattern && !this.customTileImageBitmapMaker) {
      throw new Error("One of the option 'urlPattern' or 'customTileImageBitmapMaker' must be provided.");
    }

    this.terrainEncoding = options.terrainEncoding;
    this.gaussianScaleSpaceWeights = {
      ...defaultGaussianScaleSpaceWeights,
      ...(options.gaussianScaleSpaceWeights ?? {}),
    };
    this.color = options.color ?? [0, 0, 0];
    this.alpha = options.alpha ? clamp(0, 1, options.alpha) : 0.75;
    this.minzoom = options.minzoom ? clamp(0, 22, options.minzoom) : 0;
    this.maxzoom = options.maxzoom ? clamp(0, 22, options.maxzoom) : 12;
  }

  /**
   * Get the custom protocol name specific to this ShadyGroove instance
   */
  getProtocolName(): string {
    return this.protocolName;
  }

  /**
   * Get the protocol tile loading function for maplibregl.addProtocol().
   * Tile are computed on WebGL by default (faster) but this can be disabled to
   * compute tiles on pure JS on a webworker
   */
  getProtocolLoadFunction(options: { webgl: boolean } = { webgl: true }): AddProtocolAction {
    const f = async (requestParameters: RequestParameters, abortController: AbortController) => {
      const url = requestParameters.url;
      try {
        const urlObj = new URL(url);
        const urlParams = urlObj.searchParams;
        const z = Number.parseInt(urlParams.get("z") as string, 10);
        const x = Number.parseInt(urlParams.get("x") as string, 10);
        const y = Number.parseInt(urlParams.get("y") as string, 10);

        let tile: ImageBitmap | null;

        if (options.webgl) {
          tile = await this.computeTileGl({ z, x, y }, { abortSignal: abortController?.signal });
        } else {
          tile = await this.computeTile({ z, x, y }, { abortSignal: abortController?.signal });
        }

        return { data: tile };
      } catch (err) {
        if (abortController?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw err;
      }
    };

    return f;
  }

  private initGl(tileSize: number) {
    if (this.rctx) return;

    this.rctx = new RasterContext({
      width: tileSize + 2 * this.padding,
      height: tileSize + 2 * this.padding,
      offscreen: true,
    });

    this.lowPassHorizontalNode = new ProcessingNode(this.rctx, {
      renderToTexture: true,
      reuseOutputTexture: false,
    });

    this.lowPassHorizontalNode.setShaderSource({
      fragmentShaderSource: fragmentShaderBlurPass,
    });

    this.lowPassVerticalNode = new ProcessingNode(this.rctx, {
      renderToTexture: true,
      reuseOutputTexture: false,
    });

    this.lowPassVerticalNode.setShaderSource({
      fragmentShaderSource: fragmentShaderBlurPass,
    });

    this.combineNode = new ProcessingNode(this.rctx, {
      renderToTexture: false,
    });

    this.combineNode.setShaderSource({
      fragmentShaderSource: fragmentShaderCombine,
    });
  }

  /**
   * Compute a tile as an ImageBitmap, using CPU.
   * This function is somewhat internal but left public for debugging purpose
   * or to export  static asset.
   */
  async computeTile(
    tileIndex: TileIndex,
    options: {
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<ImageBitmap | null> {
    const tilePromises = await Promise.allSettled(this.makeTilePromises(tileIndex, options));

    if (tilePromises[0].status !== "fulfilled" || !tilePromises[0].value) {
      return null;
    }

    if (options.abortSignal?.aborted) {
      return null;
    }

    const imageBitmaps = tilePromises.map((res) => (res.status === "fulfilled" ? res.value : null));
    const paddedCanvas = createPaddedTileOffscreenCanvas(imageBitmaps, this.padding);
    const paddedTile = await createImageBitmap(paddedCanvas);
    const tileSize = imageBitmaps[0]?.width as number;

    return new Promise((resolve) => {
      const tileWorker = new TileWorker();

      options.abortSignal?.addEventListener("abort", () => {
        console.log("ABORT tile: ", tileIndex);
        tileWorker.terminate();
      });

      tileWorker.postMessage(
        {
          tileIndex,
          tileSize,
          terrainEncoding: this.terrainEncoding,
          paddedTile,
          padding: this.padding,
          gaussianScaleSpaceWeights: this.gaussianScaleSpaceWeights[tileIndex.z],
          color: this.color,
        },
        [paddedTile],
      );

      tileWorker.onmessage = (e: MessageEvent<ImageBitmap>) => {
        tileWorker.terminate();
        resolve(e.data);
      };
    });
  }

  private makeTilePromises(
    tileIndex: TileIndex,
    options: {
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<ImageBitmap | null>[] {
    if (this.urlPattern) {
      return [
        this.tileCache.getTile(tileIndex, this.urlPattern, options.abortSignal), // center
        this.tileCache.getTile(getNeighborIndex(tileIndex, "N"), this.urlPattern, options.abortSignal), // north
        this.tileCache.getTile(getNeighborIndex(tileIndex, "NE"), this.urlPattern, options.abortSignal),
        this.tileCache.getTile(getNeighborIndex(tileIndex, "E"), this.urlPattern, options.abortSignal),
        this.tileCache.getTile(getNeighborIndex(tileIndex, "SE"), this.urlPattern, options.abortSignal),
        this.tileCache.getTile(getNeighborIndex(tileIndex, "S"), this.urlPattern, options.abortSignal),
        this.tileCache.getTile(getNeighborIndex(tileIndex, "SW"), this.urlPattern, options.abortSignal),
        this.tileCache.getTile(getNeighborIndex(tileIndex, "W"), this.urlPattern, options.abortSignal),
        this.tileCache.getTile(getNeighborIndex(tileIndex, "NW"), this.urlPattern, options.abortSignal),
      ];
    }

    if (this.customTileImageBitmapMaker) {
      return [
        this.customTileImageBitmapMaker(tileIndex, options.abortSignal), // center
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "N"), options.abortSignal), // north
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "NE"), options.abortSignal),
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "E"), options.abortSignal),
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "SE"), options.abortSignal),
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "S"), options.abortSignal),
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "SW"), options.abortSignal),
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "W"), options.abortSignal),
        this.customTileImageBitmapMaker(getNeighborIndex(tileIndex, "NW"), options.abortSignal),
      ];
    }

    return [];
  }

  /**
   * Compute a tile as an ImageBitmap using GPU.
   * This function is somewhat internal but left public for debugging purpose
   * or to export  static asset.
   */
  async computeTileGl(
    tileIndex: TileIndex,
    options: {
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<ImageBitmap | null> {
    const tilePromises = await Promise.allSettled(this.makeTilePromises(tileIndex, options));

    if (tilePromises[0].status !== "fulfilled" || !tilePromises[0].value) {
      return null;
    }

    if (options.abortSignal?.aborted) {
      return null;
    }

    const imageBitmaps = tilePromises.map((res) => (res.status === "fulfilled" ? res.value : null));
    const paddedCanvas = createPaddedTileOffscreenCanvas(imageBitmaps, this.padding);
    const paddedTile = await createImageBitmap(paddedCanvas);
    const tileSize = imageBitmaps[0]?.width as number;
    const gaussianScaleSpaceWeights = this.gaussianScaleSpaceWeights[tileIndex.z];

    this.initGl(tileSize);
    // The pipeline is shared across tile requests. Only textures created by this
    // render are temporary; freeing the context also destroys the shared shaders.
    const tileTextures: Texture[] = [];
    try {
      const tex = Texture.fromImageSource(this.rctx, paddedTile);
      tileTextures.push(tex);

      const lowPassTextures: Record<number, Texture | null> = {
        3: null,
        7: null,
        15: null,
        30: null,
        60: null,
      } as const;

      const kernelRadii = Object.keys(lowPassTextures).map((r) => Number.parseInt(r, 10));

      for (const radius of kernelRadii) {
        const kernel = Array.from(buildGaussianKernelFromRadius(radius));

        this.lowPassHorizontalNode.setUniformNumber("u_kernel", kernel);
        this.lowPassHorizontalNode.setUniformNumber("u_kernelSize", kernel.length, UNIFORM_TYPE.INT);
        this.lowPassHorizontalNode.setUniformBoolean("u_isHorizontalPass", true);
        this.lowPassHorizontalNode.setUniformTexture2D("u_tile", tex);
        this.lowPassHorizontalNode.render();
        tileTextures.push(this.lowPassHorizontalNode.getOutputTexture());

        this.lowPassVerticalNode.setUniformNumber("u_kernel", kernel);
        this.lowPassVerticalNode.setUniformNumber("u_kernelSize", kernel.length, UNIFORM_TYPE.INT);
        this.lowPassVerticalNode.setUniformBoolean("u_isHorizontalPass", false);
        this.lowPassVerticalNode.setUniformTexture2D("u_tile", this.lowPassHorizontalNode);
        this.lowPassVerticalNode.render();

        lowPassTextures[radius] = this.lowPassVerticalNode.getOutputTexture();
        tileTextures.push(lowPassTextures[radius]);
      }

      this.combineNode.setUniformRGB("u_tint", this.color);
      this.combineNode.setUniformTexture2D("u_tile", tex);
      this.combineNode.setUniformNumber("u_alpha", this.alpha);
      this.combineNode.setUniformNumber("u_weightLowPass_3", gaussianScaleSpaceWeights.hKernel3);
      this.combineNode.setUniformNumber("u_weightLowPass_7", gaussianScaleSpaceWeights.hKernel7);
      this.combineNode.setUniformNumber("u_weightLowPass_15", gaussianScaleSpaceWeights.hKernel15);
      this.combineNode.setUniformNumber("u_weightLowPass_30", gaussianScaleSpaceWeights.hKernel30);
      this.combineNode.setUniformNumber("u_weightLowPass_60", gaussianScaleSpaceWeights.hKernel60);

      this.combineNode.setUniformTexture2D("u_tileLowPass_3", lowPassTextures[3] as Texture);
      this.combineNode.setUniformTexture2D("u_tileLowPass_7", lowPassTextures[7] as Texture);
      this.combineNode.setUniformTexture2D("u_tileLowPass_15", lowPassTextures[15] as Texture);
      this.combineNode.setUniformTexture2D("u_tileLowPass_30", lowPassTextures[30] as Texture);
      this.combineNode.setUniformTexture2D("u_tileLowPass_60", lowPassTextures[60] as Texture);

      this.combineNode.render();

      // Snapshot the pixels synchronously, before another request can render.
      // Bitmap creation can then finish asynchronously after texture cleanup.
      return createImageBitmap(
        this.combineNode.getImageData({
          x: this.padding,
          y: this.padding,
          w: tileSize,
          h: tileSize,
        }),
      );
    } finally {
      for (const texture of tileTextures) texture.free();
      paddedTile.close();
    }
  }

  /**
   * Add the ShadyGroove layer to the map
   */
  addToMap(map: MLMap, beforeId?: string): { sourceId: string; layerId: string } {
    this.map = map;

    // Adding the tile source for our ShadyGroove layer
    map.addSource(this.sourceId, {
      type: "raster",
      tiles: [`${this.protocolName}://tile?z={z}&x={x}&y={y}`],
      minzoom: this.minzoom,
      maxzoom: this.maxzoom,
    });

    // Adding the ShadyGroove layer
    map.addLayer(
      {
        id: this.layerId,
        source: this.sourceId,
        type: "raster",
        layout: {
          visibility: "visible",
        },
      },
      beforeId,
    );

    return {
      sourceId: this.sourceId,
      layerId: this.layerId,
    };
  }

  /**
   *
   * @param isVisible
   * @returns
   */
  setVisibility(isVisible: boolean) {
    if (!this.map) {
      console.warn("This layer is not yet added to the map.");
      return;
    }

    if (isVisible) {
      this.map.setLayoutProperty(this.layerId, "visibility", "visible");
    } else {
      this.map.setLayoutProperty(this.layerId, "visibility", "none");
    }
  }

  /**
   * Get if the layer is visible
   */
  isVisible() {
    if (!this.map) {
      console.warn("This layer is not yet added to the map.");
      return false;
    }

    return this.map.getLayoutProperty(this.layerId, "visibility") === "visible";
  }
}
