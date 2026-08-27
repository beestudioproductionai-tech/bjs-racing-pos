// File: src/lib/mapBasemap.js
// Helper bersama untuk komponen peta MapLibre GL JS di POS.
// - Lazy load maplibre + css.
// - Sediakan style basemap Protomaps (OpenFreeMap) gratis, tanpa API key.
// - Utilitas GeoJSON & koordinat toko.

export const BASEMAP_URL = "https://tiles.openfreemap.org/styles/positron";

export const MAP_ATTRIBUTION =
  '© <a href="https://openfreemap.org">OpenFreeMap</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const STORE_LAT = Number(
  import.meta.env.VITE_BITESHIP_ORIGIN_LAT || import.meta.env.BITESHIP_ORIGIN_LAT || -6.5244682,
);
export const STORE_LNG = Number(
  import.meta.env.VITE_BITESHIP_ORIGIN_LNG || import.meta.env.BITESHIP_ORIGIN_LNG || 110.7674915,
);
export const STORE_NAME =
  import.meta.env.VITE_STORE_NAME || import.meta.env.STORE_NAME || "BJS Racing Store";

let mlPromise = null;

/** Lazy-load maplibre-gl (client only). Cache hasilnya. */
export async function loadMaplibre() {
  if (mlPromise) return mlPromise;
  mlPromise = (async () => {
    const mod = await import("maplibre-gl");
    await import("maplibre-gl/dist/maplibre-gl.css");
    return mod;
  })();
  return mlPromise;
}

/**
 * Memuat style basemap Protomaps (OpenFreeMap).
 * Diberikan `overrides` untuk menambah/ubah source & layer (mis. label bahasa Indonesia).
 */
export async function getBasemapStyle(overrides) {
  const res = await fetch(BASEMAP_URL);
  if (!res.ok) throw new Error(`Basemap HTTP ${res.status}`);
  const style = await res.json();
  if (typeof overrides === "function") overrides(style);
  return style;
}

/** Buat GeoJSON FeatureCollection LineString dari array koordinat [lng,lat]. */
export function lineString(coordinates) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

/** Buat GeoJSON FeatureCollection titik tunggal. */
export function point(lng, lat, properties = {}) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties,
        geometry: { type: "Point", coordinates: [lng, lat] },
      },
    ],
  };
}

// Routing OSRM publik + fallback garis lurus (sama pola dgn STORE src/lib/osrm.ts).
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

export async function getOsrmRoute(origin, destination, timeoutMs = 5000) {
  const url = `${OSRM_BASE}/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
    const json = await response.json();
    const route = json.routes?.[0];
    if (!route) throw new Error("OSRM: no route found");
    const coords = route.geometry?.coordinates ?? [];
    const geometry = coords.map((c) => [c[0], c[1]]);
    return {
      distanceMeters: Math.round(route.distance ?? 0),
      durationSeconds: Math.round(route.duration ?? 0),
      geometry,
      fallback: false,
    };
  } catch (error) {
    clearTimeout(timeout);
    console.warn("OSRM failed, fallback to straight line:", error);
    const dx = destination[0] - origin[0];
    const dy = destination[1] - origin[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    const distanceMeters = Math.round(dist * 111_000);
    return {
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / 20),
      geometry: [origin, destination],
      fallback: true,
    };
  }
}

export function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} jam ${m} menit` : `${h} jam`;
  }
  return `${mins} menit`;
}
