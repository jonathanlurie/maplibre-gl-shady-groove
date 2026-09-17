import QuickLRU from "quick-lru";
import { fetchAsImageBitmap, ImageFetchError, wrapTileIndex } from "./tools";
import type { TileIndex } from "./types";

export type TileCacheOptions = {
  cacheSize?: number;
};

export class TileCache {
  private readonly tilePool: QuickLRU<string, ImageBitmap>;

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
   * The caller owns the returned bitmap and must close it after use.
   * Cache eviction must not invalidate a bitmap still needed by a caller.
   * Missing tiles return null; cancellation and transient failures reject.
   */
  async getTile(tileIndex: TileIndex, urlPattern: string, abortSignal?: AbortSignal): Promise<ImageBitmap | null> {
    abortSignal?.throwIfAborted();
    const tileIndexWrapped = wrapTileIndex(tileIndex);
    // Longitude wraps; rows outside the Mercator extent do not exist.
    if (tileIndexWrapped.y < 0 || tileIndexWrapped.y >= 2 ** tileIndexWrapped.z) return null;
    const tileUrl = urlPattern
      .replace("{x}", tileIndexWrapped.x.toString())
      .replace("{y}", tileIndexWrapped.y.toString())
      .replace("{z}", tileIndexWrapped.z.toString());

    const cached = this.tilePool.get(tileUrl);
    let source: ImageBitmap;
    try {
      source = cached ?? (await fetchAsImageBitmap(tileUrl, abortSignal));
    } catch (error) {
      abortSignal?.throwIfAborted();
      if (error instanceof ImageFetchError && (error.status === 404 || error.status === 410)) return null;
      throw error;
    }

    let copy: ImageBitmap | undefined;
    try {
      // Snapshot before yielding, while the cache's bitmap is still valid.
      copy = await createImageBitmap(source);
      abortSignal?.throwIfAborted();
      if (!cached) {
        // Another request may have populated this entry during the fetch.
        if (this.tilePool.has(tileUrl)) source.close();
        else this.tilePool.set(tileUrl, source);
      }
      return copy;
    } catch (error) {
      copy?.close();
      if (!cached) source.close();
      throw error;
    }
  }

  /**
   * Clear the tile cache
   */
  clear() {
    for (const bitmap of this.tilePool.values()) bitmap.close();
    this.tilePool.clear();
  }
}
