-- ============================================================
-- Migration: Sinkron skema kendaraan + policy baca publik
-- Date: 2026-08-23
-- Ref: docs/plan-fix-vehicle-compatibility.md (follow-up produksi)
--
-- Latar belakang:
-- 1. DB produksi dibuat dari versi migrasi lama sehingga kolom
--    is_active hilang di vehicle_brands dan vehicle_models.
--    Query yang menyebut is_active gagal (42703) → picker kendaraan
--    di ProductModal tampil "Belum ada data kendaraan".
-- 2. RLS aktif dengan policy khusus authenticated membuat filter
--    kendaraan di storefront publik (CatalogFilter, anon) kosong.
--
-- Solusi:
-- - Tambah kolom is_active (baris lama otomatis true via DEFAULT).
-- - Policy SELECT publik untuk tabel lookup katalog (anon + authenticated).
-- - Penulisan tetap terkunci admin (policy *_auth_all FOR ALL TO authenticated).
-- - Pivot product_vehicle_compatibilities tetap tertutup untuk anon;
--   storefront mengakses fitment lewat RPC search_products (SECURITY DEFINER).
-- ============================================================

-- 1. Sinkronkan skema dengan repo migration 20260822000000
ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Baca publik untuk tabel lookup katalog kendaraan
DROP POLICY IF EXISTS "vehicle_kategori_public_read" ON vehicle_kategori;
CREATE POLICY "vehicle_kategori_public_read" ON vehicle_kategori
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "vehicle_brands_public_read" ON vehicle_brands;
CREATE POLICY "vehicle_brands_public_read" ON vehicle_brands
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "vehicle_models_public_read" ON vehicle_models;
CREATE POLICY "vehicle_models_public_read" ON vehicle_models
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "vehicle_codes_public_read" ON vehicle_codes;
CREATE POLICY "vehicle_codes_public_read" ON vehicle_codes
  FOR SELECT TO anon, authenticated USING (true);
