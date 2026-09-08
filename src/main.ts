import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { getStyle } from "basemapkit";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { ShadyGroove } from "./lib";

maplibregl.setWorkerUrl(workerUrl);

const demo = async () => {
  maplibregl.addProtocol("pmtiles", new Protocol().tile);

  const terrainEncoding = "terrarium";
  const mapterhornTileJson = "https://tiles.mapterhorn.com/tile.json";
  const mapterhornUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

  const sg = new ShadyGroove({
    urlPattern: mapterhornUrlPattern,
    terrainEncoding,
    color: [36, 70, 125],
    maxzoom: 16,
    alpha: 0.99,
  });

  const style = getStyle("avenue", {
    pmtiles: "https://fsn1.your-objectstorage.com/public-map-data/pmtiles/planet.pmtiles",
    sprite:
      "https://raw.githubusercontent.com/jonathanlurie/phosphor-mlgl-sprite/refs/heads/main/sprite/phosphor-diecut",
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    lang: "en",
    hidePOIs: true,
    globe: true,
    terrain: {
      tilejson: mapterhornTileJson,
      encoding: terrainEncoding,
      hillshading: true,
    },
  });

  const map = new maplibregl.Map({
    container: "app",
    hash: true,
    style: style,
    maxPitch: 80,
  });

  await new Promise((resolve) => map.on("load", resolve));

  sg.addToMap(map, "water_stream");

  // Adding a checkbox to toggle the visibility of the ShadyGroove layer
  const checkboxLayer = document.getElementById("toggle-layer-cb") as HTMLInputElement;
  checkboxLayer.addEventListener("change", () => {
    sg.setVisibility(checkboxLayer.checked);
  });
};

demo();
