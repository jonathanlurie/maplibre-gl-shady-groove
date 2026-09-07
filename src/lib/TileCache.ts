import QuickLRU from "quick-lru";
import { fetchAsImageBitmap, wrapTileIndex } from "./tools";
import type { TileIndex } from "./types";

export type TileCacheOptions = {
  cacheSize?: number;
};

export class TileCache {
  private readonly tilePool: QuickLRU<string, ImageBitmap>;
  private readonly unavailableTiles = new Set<string>();

  constructor(options: TileCacheOptions = {}) {
    const cacheSize = options.cacheSize ?? 1000;

    this.tilePool = new QuickLRU<string, ImageBitmap>({
      maxSize: cacheSize,

      onEviction(_key: string, value: ImageBitmap) {
        value.close();
      },
    });
  }

  /**
   * Get a tile from its z/x/y index
   * If a tile is already in the cache, it will be retrieved from the cache.
   * If a tile already failed to be retrieved, it is not trying again.
   */
  getTile(tileIndex: TileIndex, urlPattern: string, abortSignal?: AbortSignal): Promise<ImageBitmap | null> {
    return new Promise((resolve) => {
      const tileIndexWrapped = wrapTileIndex(tileIndex);
      const tileUrl = urlPattern
        .replace("{x}", tileIndexWrapped.x.toString())
        .replace("{y}", tileIndexWrapped.y.toString())
        .replace("{z}", tileIndexWrapped.z.toString());

      // The tile is not existing. An unfruitful attempt was made already
      if (this.unavailableTiles.has(tileUrl)) {
        return resolve(null);
      }

      // The tile is in the pool of already fetched tiles
      if (this.tilePool.has(tileUrl)) {
        resolve(this.tilePool.get(tileUrl) as ImageBitmap);
        return;
      }

      fetchAsImageBitmap(tileUrl, abortSignal)
        .then((imgBtmp) => {
          this.tilePool.set(tileUrl, imgBtmp);
          resolve(imgBtmp);
        })
        .catch(() => {
          this.unavailableTiles.add(tileUrl);
          resolve(null);
        });
    });
  }

  /**
   * Clear the tile cache
   */
  clear() {
    this.tilePool.clear();
    this.unavailableTiles.clear();
  }
}
