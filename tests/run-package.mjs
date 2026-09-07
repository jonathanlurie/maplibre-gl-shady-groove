import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const consumer = await mkdtemp(join(tmpdir(), "shady-groove-consumer-"));
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: consumer, stdio: "inherit", ...options });

try {
  // Pack the actual distributable. The prepack hook must build it automatically.
  run("npm", ["pack", "--pack-destination", consumer, "--cache", join(consumer, "npm-cache")], { cwd: root });
  const archive = join(consumer, (await readdir(consumer)).find(name => name.endsWith(".tgz")));
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packageDir = join(consumer, "node_modules", manifest.name);
  await mkdir(packageDir, { recursive: true });
  run("tar", ["-xzf", archive, "--strip-components=1", "-C", packageDir]);
  const shipped = new Set(run("tar", ["-tzf", archive], { stdio: "pipe" }).toString().trim().split("\n").map(path => path.replace(/^package\//, "")));
  for (const entry of [manifest.types, ...Object.values(manifest.exports["."])]) {
    assert(shipped.has(entry.replace(/^\.\//, "")), `Missing package entry: ${entry}`);
  }
  assert([...shipped].every(path => path.startsWith("dist-lib/") || ["package.json", "readme.md", "LICENSE"].includes(path)));

  // Reuse installed runtime/peer dependencies, but never link the library source
  // or its development tooling into the consumer package.
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    await symlink(join(root, "node_modules", name), join(consumer, "node_modules", name), "dir");
  }
  // MapLibre installs @types/geojson and relies on its global namespace.
  await mkdir(join(consumer, "node_modules/@types"));
  await symlink(join(root, "node_modules/@types/geojson"), join(consumer, "node_modules/@types/geojson"), "dir");
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await writeFile(join(consumer, "types.ts"), `
import { ShadyGroove, defaultGaussianScaleSpaceWeights } from "${manifest.name}";
import type {
  ShadyGrooveOptions, CustomTileImageBitmapMaker, TerrainEncoding,
  GaussianScaleSpaceWeights, GaussianScaleSpaceWeightsPerZoomLevel, RGBColor, TileIndex,
} from "${manifest.name}";
import type { Map, AddProtocolAction } from "maplibre-gl";
const tile: TileIndex = { z: 4, x: 8, y: 6 };
const encoding: TerrainEncoding = "terrarium";
const color: RGBColor = [0, 0, 0];
const weight: GaussianScaleSpaceWeights = defaultGaussianScaleSpaceWeights[4];
const weights: GaussianScaleSpaceWeightsPerZoomLevel = { 4: weight };
const loader: CustomTileImageBitmapMaker = async (_tile, signal) => {
  signal?.throwIfAborted();
  return null;
};
const options: ShadyGrooveOptions = {
  customTileImageBitmapMaker: loader, terrainEncoding: encoding, color,
  gaussianScaleSpaceWeights: weights,
};
const shade = new ShadyGroove(options);
const protocol: AddProtocolAction = shade.getProtocolLoadFunction();
declare const map: Map;
shade.addToMap(map);
shade.computeTile(tile);
shade.computeTileGl(tile);
void protocol;
// @ts-expect-error Invalid terrain encodings must not silently become any.
const invalid: TerrainEncoding = "invalid";
`);
  const testSource = (await readFile(join(root, "tests/webgl.ts"), "utf8"))
    .replace('"../src/lib/ShadyGroove"', JSON.stringify(manifest.name))
    .replace('"../src/lib/types"', JSON.stringify(manifest.name));
  await writeFile(join(consumer, "webgl.ts"), testSource);
  await writeFile(join(consumer, "main.ts"), `
import { run } from "./webgl";
(globalThis as typeof globalThis & { packageTest: ReturnType<typeof run> }).packageTest = run();
`);
  await writeFile(join(consumer, "index.html"), '<!doctype html><html><head><title>Package consumer</title></head><body><script type="module" src="/main.ts"></script></body></html>');
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: ["geojson"], lib: ["ES2022", "DOM", "DOM.Iterable"] },
    include: ["*.ts"],
  }));
  run(join(root, "node_modules/.bin/tsc"), ["-p", join(consumer, "tsconfig.json")]);
  console.log("Packed consumer passes Bundler resolution without Vite types or skipLibCheck.");
  run(process.execPath, ["--input-type=module", "-e", `
    import { ShadyGroove } from "${manifest.name}";
    const shade = new ShadyGroove({ urlPattern: "https://example.com/{z}/{x}/{y}.png", terrainEncoding: "terrarium" });
    if (typeof shade.getProtocolLoadFunction() !== "function") throw new Error("Invalid public API");
  `]);
  await build({ root: consumer, configFile: false, logLevel: "warn" });
  run(process.execPath, [join(root, "tests/run-webgl.mjs")], {
    env: { ...process.env, TEST_ROOT: join(consumer, "dist"), TEST_PAGE: "/", TEST_EXPRESSION: "globalThis.packageTest" },
  });
  console.log("Packed library imports, type-checks, bundles, and renders using WebGL and its inline CPU worker.");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
