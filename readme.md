# Shady Groove
**Better terrain reading** thanks to better terrain shading, for MapLibre GL JS. Because grooves, trenches, valleys, pits, ravines, ditches, cavities, canyons, and chasms are more often than not dark places, and deserve to be shown as such.

![logo](resources/logo.png)

[Demo with Basemapkit's Avenue style](https://shady-groove.jnth.io?demo=avenue) - [Demo with Basemapkit Atmosphere style](https://shady-groove.jnth.io?demo=atmosphere)

## Install it
```bash
npm install maplibre-gl-shady-groove
```

## Use it
```ts
import * as maplibregl from "maplibre-gl";
import { ShadyGroove, type ShadyGrooveOptions } from "maplibre-gl-shady-groove";

// Use your application's existing MapLibre map and worker/CSS setup.
const options: ShadyGrooveOptions = {
  // URL schema for terrain tiles
  urlPattern: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",

  // At the moment, only the "terrarium" encoding works, "mapbox" soon...
  terrainEncoding: "terrarium",

  // Color of the shadow as [R, G, B]
  color: [36, 70, 125],

  // Opacity of the layer
  alpha: 0.75,

  // Max zoom level at wich to generate Shady Groove tiles (will overzoom beyond)
  maxzoom: 16,
};

// Instanciate a Shady Groove layer
const shade = new ShadyGroove(options);

// Once your map's style has loaded:
map.on("load", () => {

  // Then add it to the map when ready
  shade.addToMap(map); // Optional second argument: a layer ID to insert before.
});
```

## How it looks like
![](resources/screenshots/terrain-header.jpeg)

But let's compare...

| ❌ Without Shady Groove | ✅ With Shady Groove |
|:---:|:---:|
| ![](resources/screenshots/compare-1.jpeg) | ![](resources/screenshots/compare-2.jpeg) |
| ![](resources/screenshots/compare-3.jpeg) | ![](resources/screenshots/compare-4.jpeg) |
| ![](resources/screenshots/compare-5.jpeg) | ![](resources/screenshots/compare-6.jpeg) |
| ![](resources/screenshots/compare-7.jpeg) | ![](resources/screenshots/compare-8.jpeg) |
| ![](resources/screenshots/compare-9.jpeg) | ![](resources/screenshots/compare-10.jpeg) |
| ![](resources/screenshots/compare-11.jpeg) | ![](resources/screenshots/compare-12.jpeg) |
| ![](resources/screenshots/compare-13.jpeg) | ![](resources/screenshots/compare-14.jpeg) |
| ![](resources/screenshots/compare-15.jpeg) | ![](resources/screenshots/compare-16.jpeg) |
| ![](resources/screenshots/compare-17.jpeg) | ![](resources/screenshots/compare-18.jpeg) |
| ![](resources/screenshots/compare-19.jpeg) | ![](resources/screenshots/compare-20.jpeg) |
| ![](resources/screenshots/compare-21.jpeg) | ![](resources/screenshots/compare-22.jpeg) |
| ![](resources/screenshots/compare-23.jpeg) | ![](resources/screenshots/compare-24.jpeg) |
| ![](resources/screenshots/compare-25.jpeg) | ![](resources/screenshots/compare-26.jpeg) |
| ![](resources/screenshots/compare-27.jpeg) | ![](resources/screenshots/compare-28.jpeg) |


## How it works?
There is a [full explanation here](SHADING_ALGORITHM.md), but in short, Shady Groove:
- uses gaussian scale spaces
- computes soft versions of terrains tiles, with increasing gaussian kernel sizes
- computes the difference between each soft from the original terrain
- keeps only the differences if they are in the direction that the soft is above the original, to highlight depressions and not peaks
- sum the weighted differences from each kernels, to increase the effect as the grooves get narrower

The reason we use multiple kernel size is to be able to highlight grooves of multiple size. Small kernels will only fall into narrow trenches, while large kernels will only fall into large valleys. The differences are weighted on per-zoom-level and per-kernel basis so that depending on the level of detail (zoom level), we can give more importance to narrow trenches or to large valleys.  
Will all these combines, we can add a soft shadows to large structures while producing sharper and darker shadows to narrow trenches.

Below is an example of terrain profile plot. The original (unblurred) is the black line and the gray profiles correspond to increasingly large gaussian kernels:

![plot of profile](resources/plot.png)