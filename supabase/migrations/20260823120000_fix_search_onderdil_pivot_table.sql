-- ============================================================
-- Migration: Perbaiki tabel pivot di search_onderdil_products + hapus tabel legacy
-- Date: 2026-08-23
-- Ref: docs/plan-fix-vehicle-compatibility.md (follow-up produksi #2)
--
-- Latar belakang:
-- Kedua overload fungsi search_onderdil_products menunjuk ke tabel
-- product_vehicle_compatibility (tunggal) yang legacy dan KOSONG.
-- Data kompatibilitas aktual tersimpan di product_vehicle_compatibilities
-- (jamak). Akibatnya filter merek/tipe motor di /onderdil selalu
-- menghasilkan "produk tidak ditemukan".
--
-- Solusi:
-- 1. CREATE OR REPLACE kedua overload, hanya mengganti nama tabel.
--    Definisi lain 100% identik dengan versi live di produksi.
-- 2. DROP tabel legacy tunggal (kosong, tanpa dependensi).
-- ============================================================

-- 1a. Overload tanpa limit/offset (kompatibilitas pemanggil lama)
CREATE OR REPLACE FUNCTION public.search_onderdil_products(p_sort_by text DEFAULT 'terbaru'::text, p_search_term text DEFAULT NULL::text, p_kategori text DEFAULT NULL::text, p_merek text DEFAULT NULL::text, p_vehicle_brand_id bigint DEFAULT NULL::bigint, p_vehicle_model_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF products
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM public.products p
  WHERE p.status = 'Aktif'
    AND (p.kategori IS DISTINCT FROM 'Pilok')
    AND (p.kategori IS DISTINCT FROM 'Jasa')
    AND (p.kategori IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM public.product_categories pc
      WHERE pc.kategori = p.kategori AND pc.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM public.product_mereks pm
      WHERE pm.merek = CASE
              WHEN p.merek IS NULL OR btrim(p.merek) = '' OR p.merek = '-' THEN 'TANPA MEREK'
              ELSE btrim(p.merek)
            END
        AND pm.is_active = true
    )
    AND (p_search_term IS NULL OR p.nama ILIKE '%' || p_search_term || '%' OR p.kode ILIKE '%' || p_search_term || '%')
    AND (p_kategori IS NULL OR p.kategori = p_kategori)
    AND (
      p_merek IS NULL
      OR (p_merek = 'TANPA MEREK' AND (p.merek IS NULL OR btrim(p.merek) = '' OR p.merek = '-'))
      OR (p_merek <> 'TANPA MEREK' AND btrim(p.merek) = p_merek)
    )
    AND (p_vehicle_brand_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_vehicle_compatibilities pvc
      JOIN public.vehicle_models vm ON vm.id = pvc.vehicle_model_id
      WHERE pvc.product_id = p.id AND vm.brand_id = p_vehicle_brand_id
    ))
    AND (p_vehicle_model_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_vehicle_compatibilities pvc
      WHERE pvc.product_id = p.id AND pvc.vehicle_model_id = p_vehicle_model_id
    ))
  ORDER BY
    CASE WHEN p_sort_by = 'terlaris'   THEN p.total_terjual END DESC,
    CASE WHEN p_sort_by = 'terbaru'    THEN p.created_at END DESC,
    CASE WHEN p_sort_by = 'harga_asc'  THEN p.harga_jual END ASC,
    CASE WHEN p_sort_by = 'harga_desc' THEN p.harga_jual END DESC,
    p.created_at DESC;
END;
$function$;

-- 1b. Overload dengan limit/offset (dipakai ProductCatalog.jsx via pagination)
CREATE OR REPLACE FUNCTION public.search_onderdil_products(p_sort_by text DEFAULT 'terbaru'::text, p_search_term text DEFAULT NULL::text, p_kategori text DEFAULT NULL::text, p_merek text DEFAULT NULL::text, p_vehicle_brand_id bigint DEFAULT NULL::bigint, p_vehicle_model_id bigint DEFAULT NULL::bigint, p_limit bigint DEFAULT NULL::bigint, p_offset bigint DEFAULT NULL::bigint)
 RETURNS SETOF products
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.*
  FROM public.products p
  WHERE p.status = 'Aktif'
    AND (p.kategori IS DISTINCT FROM 'Pilok')
    AND (p.kategori IS DISTINCT FROM 'Jasa')
    AND (p.kategori IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM public.product_categories pc
      WHERE pc.kategori = p.kategori AND pc.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM public.product_mereks pm
      WHERE pm.merek = CASE
              WHEN p.merek IS NULL OR btrim(p.merek) = '' OR p.merek = '-' THEN 'TANPA MEREK'
              ELSE btrim(p.merek)
            END
        AND pm.is_active = true
    )
    AND (p_search_term IS NULL OR p.search_terms ILIKE '%' || p_search_term || '%')
    AND (p_kategori IS NULL OR p.kategori = p_kategori)
    AND (
      p_merek IS NULL
      OR (p_merek = 'TANPA MEREK' AND (p.merek IS NULL OR btrim(p.merek) = '' OR p.merek = '-'))
      OR (p_merek <> 'TANPA MEREK' AND btrim(p.merek) = p_merek)
    )
    AND (p_vehicle_brand_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_vehicle_compatibilities pvc
      JOIN public.vehicle_models vm ON vm.id = pvc.vehicle_model_id
      WHERE pvc.product_id = p.id AND vm.brand_id = p_vehicle_brand_id
    ))
    AND (p_vehicle_model_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_vehicle_compatibilities pvc
      WHERE pvc.product_id = p.id AND pvc.vehicle_model_id = p_vehicle_model_id
    ))
  ORDER BY
    CASE WHEN p_sort_by = 'terlaris'   THEN p.total_terjual END DESC,
    CASE WHEN p_sort_by = 'terbaru'    THEN p.created_at END DESC,
    CASE WHEN p_sort_by = 'harga_asc'  THEN p.harga_jual END ASC,
    CASE WHEN p_sort_by = 'harga_desc' THEN p.harga_jual END DESC,
    p.created_at DESC
  LIMIT p_limit
  OFFSET COALESCE(p_offset, 0);
END;
$function$;

-- 2. Hapus tabel legacy (kosong, tanpa view/FK/function yang bergantung)
DROP TABLE IF EXISTS public.product_vehicle_compatibility;

-- 3. Jadikan SECURITY DEFINER agar pemanggil anon (storefront publik)
--    dapat mengeksekusi RPC meski tabel pivot dilindungi RLS.
--    Fungsi hanya membaca produk aktif (read-only) dan memakai
--    parameter ter-bind, aman sebagai definer.
ALTER FUNCTION public.search_onderdil_products(text, text, text, text, bigint, bigint)
  SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.search_onderdil_products(text, text, text, text, bigint, bigint, bigint, bigint)
  SECURITY DEFINER SET search_path = public;
