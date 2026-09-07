import { ShadyGroove } from "../src/lib/ShadyGroove";
import type { TileIndex } from "../src/lib/types";

const tileSize = 128;

// An asymmetric depression reveals misplaced, flipped, or stale tile images.
async function terrainTile({ x }: TileIndex): Promise<ImageBitmap> {
	const canvas = new OffscreenCanvas(tileSize, tileSize);
	const ctx = canvas.getContext("2d")!;
	const pixels = ctx.createImageData(tileSize, tileSize);
	const centerX = x % 2 ? 88 : 38;
	const centerY = x % 2 ? 36 : 83;
	for (let y = 0; y < tileSize; y++) {
		for (let x = 0; x < tileSize; x++) {
			const elevation =
				2000 -
				Math.round(
					1500 * Math.exp(-((x - centerX) ** 2 + (y - centerY) ** 2) / 100),
				);
			const encoded = elevation + 32768;
			pixels.data.set(
				[encoded >> 8, encoded & 255, 0, 255],
				(y * tileSize + x) * 4,
			);
		}
	}
	ctx.putImageData(pixels, 0, 0);
	return createImageBitmap(canvas);
}

function checkTile(bitmap: ImageBitmap | null, x: number): Uint8ClampedArray {
	if (!bitmap || bitmap.width !== tileSize || bitmap.height !== tileSize) {
		throw new Error("Incorrect output tile dimensions");
	}
	const canvas = new OffscreenCanvas(tileSize, tileSize);
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(bitmap, 0, 0);
	const pixels = ctx.getImageData(0, 0, tileSize, tileSize).data;
	bitmap.close();
	let peak = 3;
	for (let i = 7; i < pixels.length; i += 4) {
		if (pixels[i] > pixels[peak]) peak = i;
	}
	const peakX = ((peak - 3) / 4) % tileSize;
	const peakY = Math.floor((peak - 3) / 4 / tileSize);
	const expectedX = x % 2 ? 88 : 38;
	const expectedY = x % 2 ? 36 : 83;
	if (
		pixels[peak] < 50 ||
		Math.abs(peakX - expectedX) > 3 ||
		Math.abs(peakY - expectedY) > 3
	) {
		throw new Error(
			`Shade is misplaced or empty: peak ${peakX},${peakY}, alpha ${pixels[peak]}; expected ${expectedX},${expectedY}`,
		);
	}
	return pixels;
}

export async function run() {
	const passed: string[] = [];
	const failed: string[] = [];
	const sg = new ShadyGroove({
		customTileImageBitmapMaker: terrainTile,
		terrainEncoding: "terrarium",
		alpha: 1,
	});
	try {
		const reference = checkTile(
			await sg.computeTileGl({ z: 4, x: 8, y: 6 }),
			8,
		);
		passed.push("first tile has correct dimensions and geographic orientation");
		checkTile(await sg.computeTileGl({ z: 4, x: 9, y: 6 }), 9);
		passed.push("second tile renders after the first tile completes");
		const tiles = await Promise.all(
			[8, 9, 10, 11].map((x) => sg.computeTileGl({ z: 4, x, y: 6 })),
		);
		tiles.forEach((tile, i) => checkTile(tile, 8 + i));
		passed.push("simultaneous requests retain their own tile contents");
		for (let i = 0; i < 20; i++) {
			const pixels = checkTile(await sg.computeTileGl({ z: 4, x: 8, y: 6 }), 8);
			if (pixels.some((value, index) => value !== reference[index]))
				throw new Error("Repeated tile changed its pixels");
		}
		passed.push(
			"repeated renders remain stable without exhausting texture units",
		);
		checkTile(await sg.computeTile({ z: 4, x: 8, y: 6 }), 8);
		passed.push("CPU worker produces a correctly oriented tile");
	} catch (error) {
		failed.push(error instanceof Error ? error.message : String(error));
	}
	return { passed, failed };
}
