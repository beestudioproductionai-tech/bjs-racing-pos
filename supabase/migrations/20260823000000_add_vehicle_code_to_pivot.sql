-- ============================================================
-- Migration: vehicle_code_id di pivot + RLS policies tabel kendaraan
-- Date: 2026-08-23
-- Ref: docs/plan-fix-vehicle-compatibility.md
-- Eksekusi manual via Supabase SQL Editor
-- ============================================================

-- 1. Kolom kode motor pada tabel pivot kompatibilitas
ALTER TABLE product_vehicle_compatibilities
  ADD COLUMN IF NOT EXISTS vehicle_code_id integer REFERENCES vehicle_codes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pvc_vehicle_code_id
  ON product_vehicle_compatibilities(vehicle_code_id);

-- 2. Aktifkan RLS untuk seluruh tabel kendaraan
ALTER TABLE vehicle_kategori                ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_brands                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_models                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_codes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_vehicle_compatibilities ENABLE ROW LEVEL SECURITY;

-- 3. Policies: authenticated boleh CRUD (POS internal admin app)
DROP POLICY IF EXISTS "vehicle_kategori_auth_all" ON vehicle_kategori;
CREATE POLICY "vehicle_kategori_auth_all" ON vehicle_kategori
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vehicle_brands_auth_all" ON vehicle_brands;
CREATE POLICY "vehicle_brands_auth_all" ON vehicle_brands
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vehicle_models_auth_all" ON vehicle_models;
CREATE POLICY "vehicle_models_auth_all" ON vehicle_models
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vehicle_codes_auth_all" ON vehicle_codes;
CREATE POLICY "vehicle_codes_auth_all" ON vehicle_codes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pvc_auth_all" ON product_vehicle_compatibilities;
CREATE POLICY "pvc_auth_all" ON product_vehicle_compatibilities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
