# Plan: Perbaikan & Pengembangan Sistem Kompatibilitas Kendaraan

**App:** `bjs-racing-pos` (React 18 + Vite 5 + Supabase)
**Referensi:** `docs/plan-product-modal-images-webp.md` §13–17 (arsitektur pivot)
**Data sumber:** `/workspaces/bjs-racing-store/data-kendaraan/` (123 entries, 5 merek)
**Date:** 2026-08-23

---

## 1. Problem Statement

1. **Dropdown "Kode Motor" di modal produk tidak berfungsi** — permanen disabled saat tambah maupun edit.
2. **Input kompatibilitas membingungkan** — cascade 4 level (Kategori → Merek → checkbox → Kode) tidak mendukung kasus nyata: 1 produk (cth. Oli) compatible dengan banyak motor lintas merek.
3. **Halaman Manajemen Kendaraan berisiko** — hard delete dengan cascade diam-diam dapat menghapus relasi produk; tanpa search/empty/loading state.

## 2. Root Cause Analysis

### 2.1 Dropdown Kode Motor (bug utama)

```
ProductModal.jsx:821  <select disabled={!vehicleCodes.length}>
ProductModal.jsx:129  useEffect → fetchVehicleCodes(brandId, modelId)
                      syarat: product.vehicle_brand_id && product.vehicle_model_id
ProductModal.jsx:107  hydration membaca productToEdit.vehicle_model_id
                      ❌ kolom TIDAK ADA di tabel products (arsitektur pivot §17.5)
ProductModal.jsx:796  field "Tipe Motor" = checkbox list → set selectedVehicleModels[],
                      BUKAN product.vehicle_model_id
```

→ `product.vehicle_model_id` tidak pernah terisi → fetch tidak pernah jalan →
`vehicleCodes = []` → dropdown disabled permanen.

### 2.2 Defect Tambahan (hasil audit)

| # | Lokasi | Masalah |
|---|--------|---------|
| A | Migration vehicle | Pivot tanpa kolom `vehicle_code_id` → pilihan kode tak tersimpan |
| B | `Produk.jsx:305-327` | Upsert tanpa delete → uncheck model tidak menghapus row (stale) |
| C | `Produk.jsx:306-310` | Brand lookup via text match `merek` = `vehicle_brands.name` ("HONDA"≠"Honda") |
| D | `ProductModal.jsx:105` | Edit mode: dropdown kategori/merek kosong walau ada pivot |
| E | `ProductModal.jsx:137` | Reopen modal sama → checkbox hilang (race deps `[productToEdit]`) |
| F | `ProductModal.jsx:790` | Ganti merek tidak reset pilihan downstream |
| G | Migration vehicle | Belum ada RLS policy 5 tabel kendaraan |
| H | `handleSubmit` | `vehicle_code_id` dikirim tapi diabaikan `handleSaveProduct` |

## 3. Keputusan Desain (disetujui user)

1. **Kolom `vehicle_code_id` baru di pivot** (nullable, per row) — bukan derive otomatis penuh.
2. **Full Unified Picker** menggantikan cascade:
   - Semua model (~123) di-load sekali dengan join brand/kategori/kode.
   - Search box (nama model / kode / merek).
   - Preset chips 1-klik: `Semua`, per-Kategori (dinamis dari data), per-Merek — additive.
   - Chips "Dipilih (N)" selalu terlihat, removable, tombol Kosongkan.
   - List grup per merek + counter `(12/38)` + select-all per grup.
   - Kode motor tampil sebagai badge inline `KVY · 2008-2012`; dropdown Kode Motor dihapus.
   - `vehicle_code_id` pivot terisi otomatis jika model punya tepat 1 kode aktif.
3. **Manajemen Kendaraan P0–P2**: soft-delete via `is_active`, delete guard hitungan dampak, search, counter, loading/empty state, quick-add kontekstual, polish kolom.

## 4. Migration SQL

File: `supabase/migrations/20260823000000_add_vehicle_code_to_pivot.sql`

- `ALTER TABLE product_vehicle_compatibilities ADD COLUMN IF NOT EXISTS vehicle_code_id integer REFERENCES vehicle_codes(id) ON DELETE SET NULL;`
- Index `idx_pvc_vehicle_code_id`.
- Enable RLS + policy authenticated CRUD untuk 5 tabel kendaraan.
- Eksekusi manual via Supabase SQL Editor (konvensi repo).

## 5. Implementasi per File

### 5.1 ProductModal.jsx — Unified Picker

**Data layer:**
- `fetchAllVehicleModels()`: `vehicle_models.select('*, vehicle_brands(id,name), vehicle_kategori(id,name), vehicle_codes(id,code,name,year_start,year_end,is_active)')`, filter aktif client-side. Dipanggil saat modal open.
- Derive `brandList` / `kategoriList` via useMemo.
- Prefill edit: query pivot `select('*') eq product_id`, depend on `[productToEdit?.id, isOpen]` → set `selectedModelIds`.
- Guard ref `compatLoadedRef` mencegah wipe pivot saat save sebelum fetch selesai.

**State:** hapus `vehicleKategoris/Brands/Models/Codes` + 2 effect cascade lama; baru: `allModels`, `modelSearch`, `loadingVehicleData`.

**Save:** susun array pivot rows lengkap dari in-memory data:
```js
{ vehicle_model_id, vehicle_brand_id: m.brand_id, vehicle_kategori_id: m.vehicle_kategori_id,
  vehicle_code_id: activeCodes.length === 1 ? activeCodes[0].id : null }
```
Signature baru: `onSave(finalProduct, compatibilityRows|null)` — `null` = skip sync pivot.

**UI:** search input → preset chips → chips dipilih → grup list per merek (header counter + toggle select-all grup, badge kode inline). Empty states: loading / DB kosong / no result.

### 5.2 Produk.jsx — handleSaveProduct

```js
if (compatibilityRows !== null && savedProductId) {
  await supabase.from('product_vehicle_compatibilities').delete().eq('product_id', savedProductId);
  const rows = compatibilityRows.map(r => ({ ...r, product_id: savedProductId }));
  for (let i = 0; i < rows.length; i += 100) { /* insert chunk */ }
}
```
Hapus logic text-match merek.

### 5.3 ManajemenKendaraan.jsx + Modals

- **P0**: aksi utama = toggle Aktif/Nonaktif (`is_active`); Hapus Permanen hanya dengan impact check (hitung tipe/kode/pemakaian produk) — blok bila dipakai, konfirmasi eksplisit detail cascade. Row nonaktif redup + filter "Tampilkan nonaktif".
- **P1**: search box per tab, counter total, spinner loading, empty state guidance, "+ Kode" dari baris Tipe (prefill modal), "+ Tipe" dari baris Merek.
- **P2**: buang kolom ID & icon ganda, fix render tahun null (`year_start ?? "?"`), error ramah duplikat di semua Vehicle*Modal, icon Navbar `FiNavigation` → 🏍️.

## 6. Urutan Eksekusi

1. Plan doc → 2. Migration SQL → 3. ProductModal → 4. Produk.jsx → 5. ManajemenKendaraan + modals + navbar → 6. `npm run build`

## 7. Validation Checklist

- [ ] Edit produk dgn pivot → model tercentang sesuai DB
- [ ] Search & preset chips (Semua/Kategori/Merek) additive & benar
- [ ] Select-all grup/global → tersimpan (chunked 100/batch)
- [ ] Uncheck/chip remove → row pivot terhapus setelah save
- [ ] `vehicle_code_id` terisi utk model 1-kode; null utk multi-kode
- [ ] Save cepat sebelum pivot load → pivot TIDAK ikut terhapus (guard)
- [ ] Kategori Pilok → section tetap tersembunyi
- [ ] Toggle nonaktif bekerja; delete diblok saat dipakai produk
- [ ] Build sukses tanpa error

## 8. Risks & Mitigations

| Risiko | Mitigasi |
|---|---|
| Embedded join `vehicle_codes` gagal bila FK tak terdeteksi | FK `vehicle_codes.vehicle_model_id` sudah ada di migration resmi |
| Wipe pivot karena race | `compatLoadedRef` guard |
| Batch >100 row ditolak PostgREST | Chunking 100/batch |
| Data kendaraan belum ter-import | Empty state mengarahkan ke import script + halaman manajemen |

## 9. Out of Scope

Import ulang data kendaraan · search by kode motor di POS (sudah ada via RPC) · rekomendasi produk otomatis.
