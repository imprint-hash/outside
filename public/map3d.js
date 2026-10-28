// The 3D night map: MapLibre GL with OpenFreeMap's free vector tiles,
// restyled dark to match the app, with extruded buildings. If the browser
// can't draw WebGL, makeMap returns null and the page shows the list only.
/* global maplibregl */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const PITCH = 55;
export const BEARING = -15;
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglOk() {
  if (typeof maplibregl === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

const C = {
  bg: "#0f0d14", land: "#15121a", park: "#10181a", wood: "#0f1618", water: "#0c1824", waterway: "#0f2130",
  landuse: "#18151e", building: "#1d1a23", casing: "#0f0d14",
  major: "#4a3f45", mid: "#3a333d", minor: "#2b2731", path: "#221f28", rail: "#2b2731", boundary: "#47404a",
  label: "#d2c6be", labelDim: "#9e9590", labelWater: "#5d8aa3", halo: "#0f0d14",
};

function roadColor(id) {
  if (/casing/.test(id)) return C.casing;
  if (/motorway|trunk_primary/.test(id)) return C.major;
  if (/secondary_tertiary/.test(id)) return C.mid;
  if (/rail/.test(id)) return C.rail;
  if (/path_pedestrian/.test(id)) return C.path;
  return C.minor;
}

// Rewrite the light "liberty" style into the app's night palette before it
// is drawn, so there's no flash of a white map.
function nightStyle(_prev, style) {
  const keep = [];
  for (const l of style.layers) {
    const id = l.id;
    const p = (l.paint = l.paint || {});
    if (l.type === "raster" || p["fill-pattern"] || p["line-pattern"]) continue;
    if (/^poi_|one_way|shield|park_outline|hatching|aeroway_runway|aeroway_taxiway|airport/.test(id)) continue;
    if (l.type === "background") p["background-color"] = C.bg;
    else if (l.type === "fill") {
      delete p["fill-outline-color"];
      p["fill-antialias"] = id === "building";
      if (id === "water") p["fill-color"] = C.water;
      else if (id === "park" || /grass|wetland/.test(id)) { p["fill-color"] = C.park; p["fill-opacity"] = 0.9; }
      else if (/wood/.test(id)) { p["fill-color"] = C.wood; p["fill-opacity"] = 0.9; }
      else if (id === "landuse_residential") { p["fill-color"] = C.land; p["fill-opacity"] = 1; }
      else if (id === "building") { p["fill-color"] = C.building; p["fill-outline-color"] = "#27222b"; }
      else { p["fill-color"] = C.landuse; p["fill-opacity"] = 0.8; }
    } else if (l.type === "line") {
      if (/^waterway/.test(id)) p["line-color"] = C.waterway;
      else if (/^boundary/.test(id)) { p["line-color"] = C.boundary; p["line-opacity"] = 0.6; }
      else if (/^tunnel/.test(id)) { p["line-color"] = roadColor(id); p["line-opacity"] = 0.5; }
      else p["line-color"] = roadColor(id);
    } else if (l.type === "symbol") {
      if (l.layout?.["icon-image"]) { delete l.layout["icon-image"]; delete l.layout["icon-optional"]; }
      const water = /^water/.test(id);
      p["text-color"] = water ? C.labelWater : /^label_(city|town|state|country)/.test(id) ? C.label : C.labelDim;
      p["text-halo-color"] = C.halo;
      p["text-halo-width"] = 1.4;
      p["text-halo-blur"] = 0.5;
    } else if (l.type === "fill-extrusion") {
      // Taller buildings catch a little more light; all stay in the slate range.
      l.minzoom = 13;
      p["fill-extrusion-color"] = ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#18151d", 40, "#1e1a23", 120, "#27222b"];
      p["fill-extrusion-height"] = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ["coalesce", ["get", "render_height"], ["get", "height"], 8]];
      p["fill-extrusion-base"] = ["coalesce", ["get", "render_min_height"], 0];
      p["fill-extrusion-opacity"] = 0.9;
      p["fill-extrusion-vertical-gradient"] = true;
    }
    keep.push(l);
  }
  style.layers = keep;
  // The attribution control below names everyone; avoid saying it twice.
  for (const s of Object.values(style.sources)) delete s.attribution;
  return style;
}

// Fetch the style and inline its tile source, so the source's own attribution
// line doesn't repeat the one the control below shows. Falls back to the URL.
async function loadStyle() {
  try {
    const style = await (await fetch(STYLE)).json();
    await Promise.all(Object.values(style.sources).map(async (src) => {
      if (src.type !== "vector" || !src.url) return;
      const tj = await (await fetch(src.url)).json();
      if (!Array.isArray(tj.tiles)) throw new Error("no tiles");
      Object.assign(src, { tiles: tj.tiles, minzoom: tj.minzoom ?? 0, maxzoom: tj.maxzoom ?? 14, bounds: tj.bounds });
      delete src.url;
    }));
    return style;
  } catch { return STYLE; }
}

/**
 * Make the map in `el`, flat and zoomed out over `center` ([lon, lat]).
 * Returns null when WebGL isn't there.
 */
export function makeMap(el, center) {
  if (!webglOk()) return null;
  let map;
  try {
    map = new maplibregl.Map({
      container: el,
      center,
      zoom: 10.5,
      pitch: 0,
      bearing: 0,
      maxPitch: 70,
      attributionControl: false,
      dragRotate: true,
      cooperativeGestures: false,
      fadeDuration: 150,
    });
  } catch { return null; }
  loadStyle().then((style) => map.setStyle(style, { transformStyle: nightStyle }));
  map.addControl(new maplibregl.AttributionControl({
    compact: false,
    customAttribution: '© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }), "bottom-right");
  map.on("style.load", () => {
    map.setLight({ anchor: "viewport", color: "#f2d9c2", intensity: 0.14, position: [1.2, 200, 40] });
    // Soft green glow on the ground under places where people like you are.
    map.addSource("glow", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    map.addLayer({
      id: "glow", type: "circle", source: "glow",
      paint: {
        "circle-color": "#4be3a5",
        "circle-blur": 1,
        "circle-opacity": 0.34,
        "circle-pitch-alignment": "map",
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 11, ["*", 8, ["sqrt", ["get", "like"]]], 16, ["*", 120, ["sqrt", ["get", "like"]]]],
      },
    }, firstLabel);
    if (map.__glow) map.getSource("glow").setData(map.__glow);
  });
  return map;
}

/** Points for the glow layer: [{ lon, lat, like }]. Safe before the style loads. */
export function setGlow(map, pts) {
  const data = { type: "FeatureCollection", features: pts.map((p) => ({ type: "Feature", properties: { like: Math.min(p.like, 8) }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) };
  map.__glow = data;
  if (map.style && map.isStyleLoaded()) map.getSource("glow")?.setData(data);
}
