// File: src/components/AreaMapPicker.jsx
// Pilih koordinat area BJS Express lewat peta MapLibre (marker bisa digeser).
// Menggantikan input lat/lng teks murni — tapi tetap sinkron dengan field teks.
import { useState, useEffect, useRef } from "react";
import {
  loadMaplibre,
  getBasemapStyle,
  STORE_LAT,
  STORE_LNG,
} from "../lib/mapBasemap.js";

export default function AreaMapPicker({ latitude, longitude, onLatLng }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [open, setOpen] = useState(false);

  const lat = Number(latitude);
  const lng = Number(longitude);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let map = null;
    let cancelled = false;

    const init = async () => {
      const ml = await loadMaplibre();
      if (cancelled) return;
      const style = await getBasemapStyle((s) => {
        s.glyphs = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
      });

      const startLat = Number.isFinite(lat) && lat !== 0 ? lat : STORE_LAT;
      const startLng = Number.isFinite(lng) && lng !== 0 ? lng : STORE_LNG;

      map = new ml.Map({
        container: containerRef.current,
        style,
        center: [startLng, startLat],
        zoom: 13,
      });
      mapRef.current = map;

      const el = document.createElement("div");
      el.style.cssText =
        "width:28px;height:28px;border-radius:50% 50% 50% 0;background:#ea580c;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);transform:rotate(-45deg);transform-origin:bottom center;";

      const marker = new ml.Marker({ element: el, draggable: true })
        .setLngLat([startLng, startLat])
        .addTo(map);

      marker.on("dragend", () => {
        const m = marker.getLngLat();
        onLatLng({ lat: m.lat, lng: m.lng });
      });

      map.on("click", (e) => {
        marker.setLngLat(e.lngLat);
        onLatLng({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      map.on("style.load", () => {
        // Source store default
        map.addSource("store", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [STORE_LNG, STORE_LAT] } },
            ],
          },
        });
        map.addLayer({
          id: "store",
          type: "circle",
          source: "store",
          paint: { "circle-radius": 6, "circle-color": "#2563eb", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
        });
      });

      markerRef.current = marker;
    };

    init().catch((err) => console.error("Gagal inisialisasi AreaMapPicker:", err));

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold px-3 py-1.5 rounded-lg"
        >
          {open ? "Tutup Peta" : "📌 Pilih di Peta"}
        </button>
        {Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && (
          <span className="text-xs text-slate-500">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </span>
        )}
      </div>
      {open && (
        <div
          ref={containerRef}
          className="w-full border rounded-lg"
          style={{ height: 280, borderRadius: 12 }}
        />
      )}
      <p className="text-xs text-slate-400 mt-1">
        Geser marker atau klik peta untuk menetapkan koordinat. Nilai terisi otomatis di field di bawah.
      </p>
    </div>
  );
}
