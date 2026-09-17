import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { getStyle } from "basemapkit";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { ShadyGroove } from "./lib";

maplibregl.setWorkerUrl(workerUrl);

const defaultDemo = async () => {
  maplibregl.addProtocol("pmtiles", new Protocol().tile);

  const terrainEncoding = "terrarium";
  const mapterhornTileJson = "https://tiles.mapterhorn.com/tile.json";
  const mapterhornUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

  const opacityRange = document.getElementById("opacity-range") as HTMLInputElement;

  const defaultOpacity = parseFloat(opacityRange.value);

  const sg = new ShadyGroove({
    urlPattern: mapterhornUrlPattern,
    terrainEncoding,
    color: [25, 25, 100],
    maxzoom: 16,
    alpha: defaultOpacity,
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
    center: [7.0219, 46.1592],
    zoom: 12,    style: style,
    maxPitch: 80,
  });

  await new Promise((resolve) => map.on("load", resolve));

  // Adding the Shady Groove layer to the map, underneath the "address_label" layer
  sg.addToMap(map, "address_label");

  // Adding an event listener to the opacity range input to update the ShadyGroove layer's opacity
  opacityRange.addEventListener("input", () => {
    sg.setOpacity(parseFloat(opacityRange.value));
  });
};

const atmosphereDemo = async () => {
  maplibregl.addProtocol("pmtiles", new Protocol().tile);

  const terrainEncoding = "terrarium";
  const mapterhornTileJson = "https://tiles.mapterhorn.com/tile.json";
  const mapterhornUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

  const opacityRange = document.getElementById("opacity-range") as HTMLInputElement;
  const defaultOpacity = parseFloat(opacityRange.value);

  const sg = new ShadyGroove({
    urlPattern: mapterhornUrlPattern,
    terrainEncoding,
    color: [0, 10, 30],
    maxzoom: 16,
    alpha: defaultOpacity,
  });

  const style = getStyle("atmosphere", {
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
    center: [7.0219, 46.1592],
    zoom: 12,
    style: style,
    maxPitch: 80,
  });

  await new Promise((resolve) => map.on("load", resolve));

  // Adding the Shady Groove layer to the map, underneath the "address_label" layer
  sg.addToMap(map);

  // Adding an event listener to the opacity range input to update the ShadyGroove layer's opacity
  opacityRange.addEventListener("input", () => {
    sg.setOpacity(parseFloat(opacityRange.value));
  });
};


const demoId = (new URLSearchParams(window.location.search)).get("demo");
if (demoId === "atmosphere") {
  atmosphereDemo();
} else {
  defaultDemo();
}