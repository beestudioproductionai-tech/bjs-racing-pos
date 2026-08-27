// File: api/bjs-express/live.js
// Vercel Serverless Function — peta live kurir BJS Express untuk POS (mock/admin).
// Mengembalikan penugasan aktif beserta: info kurir, lokasi terakhir (latest),
// dan koordinat tujuan (dari shipping_address order) untuk digambar rute.
// Frontend kemudian berlangganan Realtime `courier_locations` untuk update smooth.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const ACTIVE_STATUSES = ["assigned", "picked", "in_transit", "dropping_off"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const { data: assignments, error } = await supabase
      .from("courier_assignments")
      .select(`
        id,
        status,
        courier_id,
        order_id,
        assigned_at,
        couriers (id, name, phone, vehicle_type, plate_number),
        orders (id, order_number, status, shipping_address)
      `)
      .in("status", ACTIVE_STATUSES);

    if (error) {
      console.error("BJS Express live error:", error);
      return res
        .status(500)
        .json({ message: "Gagal memuat data kurir live.", details: error.message });
    }

    const active = (assignments || []).filter(
      (a) => a.orders && a.orders.shipping_address,
    );

    const result = await Promise.all(
      active.map(async (a) => {
        const addr = a.orders.shipping_address || {};
        const destLat = Number(addr.latitude);
        const destLng = Number(addr.longitude);

        // Lokasi terakhir kurir untuk penugasan ini
        const { data: locs, error: locErr } = await supabase
          .from("courier_locations")
          .select("lat, lng, accuracy, heading, speed, recorded_at")
          .eq("assignment_id", a.id)
          .order("recorded_at", { ascending: false })
          .limit(1);
        const loc = locs?.[0] || null;

        // Triwulan mental kuantitas lokasi (untuk statistik ringkas)
        const { count } = await supabase
          .from("courier_locations")
          .select("id", { count: "exact", head: true })
          .eq("assignment_id", a.id);

        return {
          assignment_id: a.id,
          status: a.status,
          assigned_at: a.assigned_at,
          location_count: count || 0,
          courier: a.couriers || null,
          order: {
            id: a.orders.id,
            order_number: a.orders.order_number,
            status: a.orders.status,
          },
          destination: Number.isFinite(destLat) && Number.isFinite(destLng)
            ? { lat: destLat, lng: destLng }
            : null,
          location: loc
            ? {
                lat: loc.lat,
                lng: loc.lng,
                accuracy: loc.accuracy,
                heading: loc.heading,
                speed: loc.speed,
                recorded_at: loc.recorded_at,
              }
            : null,
        };
      }),
    );

    res.status(200).json(result);
  } catch (err) {
    console.error("BJS Express live error:", err);
    res.status(500).json({ message: "Gagal memuat data kurir live.", details: err.message });
  }
}
