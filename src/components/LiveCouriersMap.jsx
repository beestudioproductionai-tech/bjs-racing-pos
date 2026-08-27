// File: src/components/LiveCouriersMap.jsx
// Halaman peta semua kurir BJS Express yang sedang aktif (live) untuk POS.
// - Menampilkan marker setiap kurir + marker tujuan pelanggan.
// - Rute kurir → tujuan mengikuti jalan (OSRM, fallback lurus).
// - Live update via Supabase Realtime `courier_locations` (interpolasi smooth).
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient.js";
import {
  loadMaplibre,
  getBasemapStyle,
  STORE_LAT,
  STORE_LNG,
  getOsrmRoute,
  formatDistance,
  formatDuration,
} from "../lib/mapBasemap.js";
import { getBjsExpressLive } from "../lib/biteshipClient.js";

const STATUS_LABEL = {
  assigned: "Ditunggu ambil di toko",
  picked: "Barang diambil",
  in_transit: "Dalam perjalanan",
  dropping_off: "Sampai di lokasi",
};

function bearing(from, to) {
  const toRad = (x) => (x * Math.PI) / 180;
  const toDeg = (x) => (x * 180) / Math.PI;
  const dLon = toRad(to.lng - from.lng);
  const y = Math.sin(dLon) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

export default function LiveCouriersMap() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mlRef = useRef(null);
  const markersRef = useRef({}); // assignment_id -> { marker, el, hasDest, dest, curPos }
  const totalFeaturesRef = useRef([]);
  const channelRef = useRef(null);
  const [data, setData] = useState([]);
  const dataRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const redraw = useCallback((ml, map) => {
    // Update source GeoJSON untuk semua titik (kurir + tujuan)
    const source = map.getSource("live-points");
    if (!source) return;
    const features = [];
    markersRef.current = markersRef.current || {};
    Object.entries(markersRef.current).forEach(([id, m]) => {
      if (m.curPos) {
        features.push({
          type: "Feature",
          properties: { k: "courier", assignment_id: id, name: m.name, status: m.status },
          geometry: { type: "Point", coordinates: [m.curPos.lng, m.curPos.lat] },
        });
      }
      if (m.hasDest && m.dest) {
        features.push({
          type: "Feature",
          properties: { k: "dest", assignment_id: id, name: m.name },
          geometry: { type: "Point", coordinates: [m.dest.lng, m.dest.lat] },
        });
      }
    });
    totalFeaturesRef.current = features;
    source.setData({ type: "FeatureCollection", features });
  }, []);

  const moveCourier = useCallback(
    (ml, map, id, lat, lng, heading) => {
      redraw(ml, map);
      const m = markersRef.current[id];
      if (!m) return;
      const target = { lng, lat };
      const start = m.curPos || target;
      const duration = 500;
      const t0 = performance.now();
      const step = (t) => {
        const marker = markersRef.current[id]?.marker;
        if (!marker) return;
        const k = Math.min(1, (t - t0) / duration);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const clng = start.lng + (target.lng - start.lng) * ease;
        const clat = start.lat + (target.lat - start.lat) * ease;
        markersRef.current[id].curPos = { lng: clng, lat: clat };
        marker.setLngLat([clng, clat]);
        redraw(ml, map);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);

      if (typeof heading === "number") {
        markersRef.current[id].el?.style.setProperty("transform", `rotate(${heading}deg)`);
      } else if (start.lng !== target.lng || start.lat !== target.lat) {
        markersRef.current[id].el?.style.setProperty("transform", `rotate(${bearing(start, target)}deg)`);
      }
    },
    [redraw],
  );

  const refreshRouteFor = useCallback((ml, map, id, origin, dest) => {
    const line = markersRef.current[id]?.line;
    if (!line) return;
    getOsrmRoute([origin[0], origin[1]], [dest.lng, dest.lat])
      .then((route) => {
        const current = markersRef.current[id];
        if (!current) return;
        current.lineEl.textContent = `Jarak: ${formatDistance(route.distanceMeters)} • ETA: ${formatDuration(route.durationSeconds)}${route.fallback ? " (perkiraan)" : ""}`;
        line.setData({
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.geometry } },
          ],
        });
      })
      .catch(() => {});
  }, []);

  const applyAssignment = useCallback(
    (ml, map, item) => {
      const id = item.assignment_id;
      const existing = markersRef.current[id];
      const hasDest = !!item.destination;
      const dest = hasDest ? { lat: item.destination.lat, lng: item.destination.lng } : null;
      const name = item.courier?.name || "Kurir";
      const status = item.status;

      if (existing) {
        existing.name = name;
        existing.status = status;
        existing.hasDest = hasDest;
        existing.dest = dest;
        if (item.location) {
          moveCourier(ml, map, id, Number(item.location.lat), Number(item.location.lng), item.location.heading != null ? Number(item.location.heading) : undefined);
        }
        return;
      }

      const el = document.createElement("div");
      const color = status === "dropping_off" ? "#f59e0b" : status === "in_transit" ? "#16a34a" : "#2563eb";
      el.className = "bjs-live-courier-marker";
      el.style.cssText =
        `width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 6px rgba(0,0,0,.12);position:relative;transition:transform .25s ease-out;cursor:pointer;`;
      el.style.backgroundImage =
        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='white'><path d='M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'/></svg>\")";
      el.style.backgroundSize = "14px";
      el.style.backgroundPosition = "center";
      el.style.backgroundRepeat = "no-repeat";
      el.addEventListener("click", () => setSelected(item));

      const marker = new ml.Marker({ element: el })
        .setLngLat([Number(item.location?.lng) || STORE_LNG, Number(item.location?.lat) || STORE_LAT])
        .addTo(map);

      const lineSource = new ml.GeoJSONSource({ data: { type: "FeatureCollection", features: [] } });
      map.addSource(`line-${id}`, lineSource);
      map.addLayer({
        id: `line-${id}`,
        type: "line",
        source: `line-${id}`,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": color, "line-width": 3, "line-opacity": 0.8 },
      });
      const lineEl = document.createElement("span");

      markersRef.current[id] = {
        id,
        marker,
        el,
        line: lineSource,
        lineEl,
        name,
        status,
        hasDest,
        dest,
        curPos: item.location ? { lng: Number(item.location.lng), lat: Number(item.location.lat) } : null,
      };

      if (item.location && hasDest) {
        refreshRouteFor(ml, map, id, [Number(item.location.lng), Number(item.location.lat)], dest);
      }
      redraw(ml, map);
    },
    [moveCourier, refreshRouteFor, redraw],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await getBjsExpressLive();
      setData(items);
      dataRef.current = items;
      const ml = mlRef.current;
      const map = mapRef.current;
      if (ml && map && !map.isStyleLoaded()) {
        map.once("style.load", () => {
          items.forEach((it) => applyAssignment(ml, map, it));
          fitBounds(ml, map, items);
        });
      } else if (ml && map) {
        items.forEach((it) => applyAssignment(ml, map, it));
        fitBounds(ml, map, items);
      }
    } catch (err) {
      setError(err.message || "Gagal memuat data kurir live.");
    } finally {
      setLoading(false);
    }
  }, [applyAssignment]);

  const fitBounds = useCallback((ml, map, items) => {
    const bounds = new ml.LngLatBounds();
    let any = false;
    items.forEach((it) => {
      if (it.location) {
        bounds.extend([Number(it.location.lng), Number(it.location.lat)]);
        any = true;
      }
      if (it.destination) {
        bounds.extend([Number(it.destination.lng), Number(it.destination.lat)]);
        any = true;
      }
    });
    if (items.length > 0 && !any) {
      bounds.extend([STORE_LNG, STORE_LAT]);
      any = true;
    }
    if (any) map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let map = null;
    let cancelled = false;

    const init = async () => {
      const ml = await loadMaplibre();
      if (cancelled) return;
      const style = await getBasemapStyle((s) => {
        s.glyphs = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
      });
      map = new ml.Map({
        container: containerRef.current,
        style,
        center: [STORE_LNG, STORE_LAT],
        zoom: 13,
      });
      mapRef.current = map;
      mlRef.current = ml;

      map.on("style.load", () => {
        if (cancelled || !map) return;
        map.addSource("live-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "courier-points",
          type: "circle",
          source: "live-points",
          filter: ["==", ["get", "k"], "courier"],
          paint: {
            "circle-radius": 5,
            "circle-color": "#16a34a",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "dest-points",
          type: "circle",
          source: "live-points",
          filter: ["==", ["get", "k"], "dest"],
          paint: {
            "circle-radius": 7,
            "circle-color": "#2563eb",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.on("click", "courier-points", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const item = dataRef.current.find((d) => d.assignment_id === f.properties.assignment_id);
          if (item) setSelected(item);
        });
        map.on("click", "dest-points", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const item = dataRef.current.find((d) => d.assignment_id === f.properties.assignment_id);
          if (item) setSelected(item);
        });
      });

      load();
    };

    init().catch((err) => console.error("Gagal inisialisasi LiveCouriersMap:", err));

    // Realtime global untuk semua lokasi kurir
    const channel = supabase
      .channel("live-couriers-all")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "courier_locations" },
        (payload) => {
          const row = payload.new;
          const ml = mlRef.current;
          const map = mapRef.current;
          if (!ml || !map || !row) return;
          const m = markersRef.current[row.assignment_id];
          if (!m) return;
          moveCourier(ml, map, row.assignment_id, Number(row.lat), Number(row.lng), row.heading != null ? Number(row.heading) : undefined);
          if (m.hasDest && m.dest) {
            refreshRouteFor(ml, map, row.assignment_id, [Number(row.lng), Number(row.lat)], m.dest);
          }
        },
      )
      .subscribe();
    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (map) map.remove();
      mapRef.current = null;
      mlRef.current = null;
      markersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">Peta Kurir Live</h1>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={load}
            className="bg-orange-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-orange-700"
          >
            Muat Ulang
          </button>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-green-600" />
            <span>Perjalanan</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-blue-600" />
            <span>Tujuan</span>
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 mb-2 text-sm">{error}</p>}
      {loading && <p className="text-sm text-slate-500 mb-2">Memuat data kurir live...</p>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div ref={containerRef} style={{ height: "72vh", minHeight: 480, borderRadius: "12px" }} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
        {data.length === 0 && !loading ? (
          <p className="text-slate-500 text-sm col-span-full">
            Tidak ada kurir yang sedang aktif (status assigned / picked / in_transit / dropping_off).
          </p>
        ) : (
          data.map((item) => {
            const activeColor =
              item.status === "dropping_off" ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800";
            return (
              <div
                key={item.assignment_id}
                onClick={() => setSelected(item)}
                className="border rounded-lg p-3 cursor-pointer hover:bg-slate-50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold">{item.courier?.name || "Kurir"}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${activeColor}`}>
                    {STATUS_LABEL[item.status] || item.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  #{item.order?.order_number || "-"} • {item.courier?.vehicle_type || ""}{" "}
                  {item.courier?.plate_number || ""}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {item.location ? (
                    <>Update: {formatTime(item.location.recorded_at)}</>
                  ) : (
                    "Belum ada lokasi / tujuan"
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {selected.courier?.name || "Kurir"}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${selected.status === "dropping_off" ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}`}>
                  {STATUS_LABEL[selected.status] || selected.status}
                </span>
              </h2>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-700" type="button">
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <p className="text-slate-500">Pesanan</p>
                <p className="text-right font-medium">#{selected.order?.order_number || "-"}</p>
                <p className="text-slate-500">Kendaraan</p>
                <p className="text-right capitalize">
                  {selected.courier?.vehicle_type || "-"} {selected.courier?.plate_number || ""}
                </p>
                <p className="text-slate-500">No. HP</p>
                <p className="text-right">{selected.courier?.phone || "-"}</p>
                <p className="text-slate-500">Jumlah lokasi tersimpan</p>
                <p className="text-right">{selected.location_count ?? "-"}</p>
                <p className="text-slate-500">Tujuan</p>
                <p className="text-right">
                  {selected.destination
                    ? `${selected.destination.lat.toFixed(5)}, ${selected.destination.lng.toFixed(5)}`
                    : "-"}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  onClick={() => setSelected(null)}
                  className="bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg hover:bg-slate-300"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
