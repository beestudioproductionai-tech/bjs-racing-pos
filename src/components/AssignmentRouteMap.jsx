// File: src/components/AssignmentRouteMap.jsx
// Peta rute per penugasan kurir BJS Express untuk POS.
// - Marker kurir (hijau) bergerak halus (interpolasi rAF) + rotasi heading.
// - Polyline rute kurir → tujuan (mengikuti jalan via OSRM, fallback lurus).
// - Live update via Supabase Realtime pada tabel `courier_locations`.
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
  point,
  lineString,
} from "../lib/mapBasemap.js";

const STATUS_LABEL = {
  assigned: "Ditunggu ambil di toko",
  picked: "Barang diambil",
  in_transit: "Dalam perjalanan",
  dropping_off: "Sampai di lokasi",
  completed: "Selesai",
  cancelled: "Dibatalkan",
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
  iso ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-";

export default function AssignmentRouteMap({
  assignment,
  height = 420,
  showDestination = true,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mlRef = useRef(null);
  const markerRef = useRef(null);
  const markerElRef = useRef(null);
  const routeSourceRef = useRef(null);
  const liveLineRef = useRef(null);
  const curPosRef = useRef(null);
  const animRef = useRef(null);
  const routeTimerRef = useRef(null);
  const channelRef = useRef(null);
  const destroyedRef = useRef(false);

  const [status, setStatus] = useState(assignment?.status || "");
  const [info, setInfo] = useState("");

  const destLat = Number(assignment?.destination?.lat);
  const destLng = Number(assignment?.destination?.lng);
  const hasDest = Number.isFinite(destLat) && Number.isFinite(destLng);
  const initial = assignment?.location;

  const updateCourier = useCallback(
    (lat, lng, heading) => {
      const map = mapRef.current;
      const marker = markerRef.current;
      if (!map || !marker) return;
      const target = { lng, lat };
      const start = curPosRef.current || target;
      const duration = 500;
      const t0 = performance.now();
      const step = (t) => {
        if (destroyedRef.current || !markerRef.current) return;
        const k = Math.min(1, (t - t0) / duration);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const clng = start.lng + (target.lng - start.lng) * ease;
        const clat = start.lat + (target.lat - start.lat) * ease;
        markerRef.current.setLngLat([clng, clat]);
        curPosRef.current = { lng: clng, lat: clat };
        if (k < 1) animRef.current = requestAnimationFrame(step);
      };
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(step);

      if (typeof heading === "number") {
        markerElRef.current?.style.setProperty("transform", `rotate(${heading}deg)`);
      } else if (start.lng !== target.lng || start.lat !== target.lat) {
        markerElRef.current?.style.setProperty("transform", `rotate(${bearing(start, target)}deg)`);
      }
    },
    [],
  );

  const refreshRoute = useCallback(
    (origin, dest) => {
      if (!hasDest) return;
      const map = mapRef.current;
      if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
      routeTimerRef.current = window.setTimeout(() => {
        const [dLng, dLat] = dest;
        getOsrmRoute([origin[0], origin[1]], [dLng, dLat])
          .then((route) => {
            if (destroyedRef.current || !map) return;
            liveLineRef.current?.setData(lineString(route.geometry));
            setInfo(
              `Jarak: ${formatDistance(route.distanceMeters)} • Estimasi: ${formatDuration(route.durationSeconds)}${route.fallback ? " (perkiraan)" : ""}`,
            );
          })
          .catch(() => {});
      }, 600);
    },
    [hasDest],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    destroyedRef.current = false;
    let map = null;
    let cancelled = false;

    const init = async () => {
      const ml = await loadMaplibre();
      if (cancelled) return;
      const style = await getBasemapStyle((s) => {
        s.glyphs = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
      });

      const startLat = Number(initial?.lat) || STORE_LAT;
      const startLng = Number(initial?.lng) || STORE_LNG;

      map = new ml.Map({
        container: containerRef.current,
        style,
        center: [startLng, startLat],
        zoom: 13,
      });
      mapRef.current = map;
      mlRef.current = ml;

      const el = document.createElement("div");
      el.className = "bjs-courier-marker";
      el.style.cssText =
        "width:24px;height:24px;border-radius:50%;background:#16a34a;border:3px solid #fff;box-shadow:0 0 0 6px rgba(22,163,74,.25);position:relative;transition:transform .25s ease-out;";
      markerElRef.current = el;
      markerRef.current = new ml.Marker({ element: el }).setLngLat([startLng, startLat]).addTo(map);

      map.on("style.load", () => {
        if (cancelled || !map) return;

        map.addSource("live-line", { type: "geojson", data: lineString([]) });
        map.addLayer({
          id: "live-line",
          type: "line",
          source: "live-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#16a34a", "line-width": 4, "line-opacity": 0.9 },
        });
        liveLineRef.current = map.getSource("live-line");

        if (hasDest) {
          map.addSource("points", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: { k: "store" },
                  geometry: { type: "Point", coordinates: [STORE_LNG, STORE_LAT] },
                },
                {
                  type: "Feature",
                  properties: { k: "dest" },
                  geometry: { type: "Point", coordinates: [destLng, destLat] },
                },
              ],
            },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "points",
            paint: {
              "circle-radius": 8,
              "circle-color": ["case", ["==", ["get", "k"], "store"], "#ea580c", "#2563eb"],
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            },
          });
          map.on("click", "points", (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const html =
              f.properties.k === "store"
                ? "<b>Toko BJS Racing</b>"
                : "<b>Alamat Pelanggan</b>";
            new ml.Popup({ offset: 20 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
        }

        getOsrmRoute([STORE_LNG, STORE_LAT], [destLng || STORE_LNG, destLat || STORE_LAT]).then(
          (route) => {
            if (cancelled || !map) return;
            if (hasDest) {
              (map.getSource("points") || {}).setData && map.getSource("points").setData({
                type: "FeatureCollection",
                features: [
                  { type: "Feature", properties: { k: "store" }, geometry: { type: "Point", coordinates: [STORE_LNG, STORE_LAT] } },
                  { type: "Feature", properties: { k: "dest" }, geometry: { type: "Point", coordinates: [destLng, destLat] } },
                ],
              });
              const bounds = new ml.LngLatBounds();
              route.geometry.forEach(([lng, lat]) => bounds.extend([lng, lat]));
              if (!cancelled) map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
            }
          },
        );

        if (initial) {
          refreshRoute([STORE_LNG, STORE_LAT], [destLng || STORE_LNG, destLat || STORE_LAT]);
        }
      });

      if (initial) updateCourier(Number(initial.lat), Number(initial.lng), Number(initial.heading));
    };

    init().catch((err) => console.error("Gagal inisialisasi AssignmentRouteMap:", err));

    return () => {
      cancelled = true;
      destroyedRef.current = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (routeTimerRef.current) window.clearTimeout(routeTimerRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (map) {
        map.remove();
      }
      mapRef.current = null;
      markerRef.current = null;
      liveLineRef.current = null;
      curPosRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id]);

  // Realtime subscription untuk update lokasi kurir penugasan ini
  useEffect(() => {
    if (!assignment?.id) return;
    const channel = supabase
      .channel(`assignment-route-${assignment.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "courier_locations", filter: `assignment_id=eq.${assignment.id}` },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          updateCourier(Number(row.lat), Number(row.lng), row.heading != null ? Number(row.heading) : undefined);
          if (hasDest) refreshRoute([Number(row.lng), Number(row.lat)], [destLng, destLat]);
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id, assignment?.destination?.lat, assignment?.destination?.lng]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} style={{ height: `${height}px`, borderRadius: "12px", width: "100%" }} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm px-1">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-green-600" />
          <span>Kurir</span>
          <span className="inline-block h-3 w-3 rounded-full bg-blue-600 ml-2" />
          <span>Pelanggan</span>
          {assignment?.courier && (
            <span className="ml-2 font-medium">
              #{assignment.order?.order_number || "-"} • {assignment.courier.name}
            </span>
          )}
        </div>
        <span className="text-slate-500">{info}</span>
      </div>
      <div className="flex items-center gap-3 px-1 text-xs text-slate-500">
        <span>Status: {STATUS_LABEL[status] || "—"}</span>
        {assignment?.location && (
          <span>Update: {formatTime(assignment.location.recorded_at)}</span>
        )}
      </div>
    </div>
  );
}
