# Shady Groove
Gaussian scale-space terrain cavity shading for MapLibre GL.

```ts
import * as maplibregl from "maplibre-gl";
import { ShadyGroove, type ShadyGrooveOptions } from "maplibre-gl-shady-groove";

// Use your application's existing MapLibre map and worker/CSS setup.
const options: ShadyGrooveOptions = {
  urlPattern: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
  terrainEncoding: "terrarium",
  color: [36, 70, 125],
  alpha: 0.75,
  maxzoom: 12,
};
const shade = new ShadyGroove(options);
maplibregl.addProtocol(shade.getProtocolName(), shade.getProtocolLoadFunction());

// Once your map's style has loaded:
map.on("load", () => {
  shade.addToMap(map); // Optional second argument: a layer ID to insert before.
});
```
