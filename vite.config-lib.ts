import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
	mode: "production",
	build: {
		copyPublicDir: false,
		minify: true,
		sourcemap: true,
		outDir: "dist-lib",
		emptyOutDir: true,
		lib: {
			entry: resolve(import.meta.dirname, "src/lib/index.ts"),
			name: "maplibre-gl-shady-groove",
			fileName: () => "maplibre-gl-shady-groove.js",
			formats: ["es"],
		},
		rolldownOptions: {
			external: ["maplibre-gl", "quick-lru", "raster-gl"],
		},
	},
	plugins: [
		dts({
			tsconfigPath: "tsconfig.lib.json",
			insertTypesEntry: true,
			entryRoot: "src/lib",
			include: "src/lib",
		}),
	],
});
