import { ShadyGroove } from "../src/lib/ShadyGroove";
import { TileCache } from "../src/lib/TileCache";

const index = { z: 4, x: 8, y: 6 };
const pattern = "https://terrain.test/{z}/{x}/{y}.png";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof Error, "Expected an Error rejection");
    return error;
  }
  throw new Error("Expected request to reject");
}

export async function run() {
  const passed: string[] = [];
  const failed: string[] = [];
  const originalFetch = globalThis.fetch;
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(128, 0, 0)";
  ctx.fillRect(0, 0, 128, 128);
  const blob = await canvas.convertToBlob();
  const test = async (name: string, body: () => Promise<void>) => {
    try {
      await body();
      passed.push(name);
    } catch (error) {
      failed.push(`${name}: ${error instanceof Error ? error.message : error}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  await test("an aborted terrain fetch can be requested again", async () => {
    const cache = new TileCache();
    const controller = new AbortController();
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const first = cache.getTile(index, pattern, controller.signal);
    controller.abort();
    const error = await rejection(first);
    assert(error.name === "AbortError", "Cancellation must reject with AbortError");
    globalThis.fetch = async () => new Response(blob);
    const next = await cache.getTile(index, pattern);
    assert(next?.width === 128, "Canceled fetch permanently poisoned the cache");
    next.close();
    cache.clear();
  });

  await test("temporary HTTP failures remain visible and retryable", async () => {
    const cache = new TileCache();
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const error = await rejection(cache.getTile(index, pattern));
    assert(error.message.includes("503"), "HTTP failure lost its status");
    globalThis.fetch = async () => new Response(blob);
    const next = await cache.getTile(index, pattern);
    assert(next?.width === 128, "Temporary failure permanently poisoned the cache");
    next.close();
    cache.clear();
  });

  await test("cache eviction does not close bitmaps held by active requests", async () => {
    const cache = new TileCache({ cacheSize: 1 });
    globalThis.fetch = async () => new Response(blob);
    const held = await cache.getTile(index, pattern);
    const other = await cache.getTile({ ...index, x: 9 }, pattern);
    assert(held?.width === 128, "Active center bitmap was closed while waiting for a neighbor");
    ctx.drawImage(held, 0, 0);
    cache.clear();
    assert(other?.width === 128, "Clearing the cache closed a caller's bitmap");
    held.close();
    other.close();
  });

  await test("closing one caller's bitmap does not invalidate another request", async () => {
    const cache = new TileCache();
    globalThis.fetch = async () => new Response(blob);
    const first = await cache.getTile(index, pattern);
    const second = await cache.getTile(index, pattern);
    first?.close();
    assert(second?.width === 128, "Requests share ownership of a closable bitmap");
    second.close();
    cache.clear();
  });

  await test("missing center tile rejects the protocol with tile coordinates", async () => {
    const sg = new ShadyGroove({ customTileImageBitmapMaker: async () => null, terrainEncoding: "terrarium" });
    const error = await rejection(sg.getProtocolLoadFunction()({ url: "test://tile?z=4&x=8&y=6" }, new AbortController()));
    assert(error.message.includes("4/8/6"), "Missing tile error does not identify the tile");
  });

  await test("center fetch errors reach the protocol instead of becoming empty tiles", async () => {
    const sg = new ShadyGroove({ urlPattern: pattern, terrainEncoding: "terrarium" });
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const error = await rejection(sg.getProtocolLoadFunction()({ url: "test://tile?z=4&x=8&y=6" }, new AbortController()));
    assert(error.message.includes("503"), "Protocol swallowed the source failure");
  });

  await test("already canceled computations reject before fetching terrain", async () => {
    let calls = 0;
    const sg = new ShadyGroove({ customTileImageBitmapMaker: async () => { calls++; return null; }, terrainEncoding: "terrarium" });
    const controller = new AbortController();
    controller.abort();
    for (const webgl of [false, true]) {
      const error = await rejection(sg.getProtocolLoadFunction({ webgl })({ url: "test://tile?z=4&x=8&y=6" }, controller));
      assert(error.name === "AbortError", "Protocol cancellation did not reject with AbortError");
    }
    assert(calls === 0, "Canceled requests still fetched terrain");
  });

  await test("aborting a running CPU worker settles its computation", async () => {
    const controller = new AbortController();
    const OriginalWorker = globalThis.Worker;
    const terrain = await createImageBitmap(canvas);
    const sg = new ShadyGroove({ customTileImageBitmapMaker: async () => terrain, terrainEncoding: "terrarium" });
    let started = false;
    globalThis.Worker = new Proxy(OriginalWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args);
        started = true;
        queueMicrotask(() => controller.abort());
        return worker;
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const error = await rejection(Promise.race([
        sg.computeTile(index, { abortSignal: controller.signal }),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("CPU abort hung")), 3000); }),
      ]));
      assert(started, "Test did not start a worker");
      assert(error.name === "AbortError", error.message);
    } finally {
      clearTimeout(timer);
      globalThis.Worker = OriginalWorker;
      terrain.close();
    }
  });

  await test("CPU processing errors settle with tile coordinates", async () => {
    const controller = new AbortController();
    const terrain = await createImageBitmap(canvas);
    const sg = new ShadyGroove({ customTileImageBitmapMaker: async () => terrain, terrainEncoding: "terrarium" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // No scale-space weights exist at z=23: this fails inside the async worker.
      const error = await rejection(Promise.race([
        sg.computeTile({ ...index, z: 23 }, { abortSignal: controller.signal }),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Worker error hung")), 3000); }),
      ]));
      assert(error.message.includes("23/8/6"), error.message);
    } finally {
      clearTimeout(timer);
      controller.abort();
      terrain.close();
    }
  });

  await test("missing neighbors do not prevent an available center tile from rendering", async () => {
    globalThis.fetch = async (input) => String(input).endsWith("/4/8/6.png")
      ? new Response(blob)
      : new Response(null, { status: 404 });
    const sg = new ShadyGroove({ urlPattern: pattern, terrainEncoding: "terrarium" });
    for (const webgl of [false, true]) {
      const response = await sg.getProtocolLoadFunction({ webgl })({ url: "test://tile?z=4&x=8&y=6" }, new AbortController());
      assert(response.data instanceof ImageBitmap && response.data.width === 128, "Missing neighbor prevented rendering");
      response.data.close();
    }
  });
  return { passed, failed };
}
