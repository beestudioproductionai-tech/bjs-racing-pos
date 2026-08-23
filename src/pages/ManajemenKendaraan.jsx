import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import VehicleKategoriModal from "../components/VehicleKategoriModal";
import VehicleBrandModal from "../components/VehicleBrandModal";
import VehicleModelModal from "../components/VehicleModelModal";
import VehicleCodeModal from "../components/VehicleCodeModal";

const NONE_KEY = "__none__";

async function countRows(table, column, values) {
  const safeValues = values.length ? values : [NONE_KEY];
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .in(column, safeValues);
  return count || 0;
}

function friendlyDbError(error) {
  const msg = error?.message || "";
  if (msg.includes("duplicate key") || msg.includes("unique")) {
    return "Nama sudah dipakai. Gunakan nama lain.";
  }
  return msg || "Terjadi kesalahan tak terduga.";
}

function ManajemenKendaraan() {
  const [activeTab, setActiveTab] = useState("kategori");
  const [kategoris, setKategoris] = useState([]);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [codes, setCodes] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);

  const [isKategoriModalOpen, setIsKategoriModalOpen] = useState(false);
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  const [kategoriToEdit, setKategoriToEdit] = useState(null);
  const [brandToEdit, setBrandToEdit] = useState(null);
  const [modelToEdit, setModelToEdit] = useState(null);
  const [codeToEdit, setCodeToEdit] = useState(null);

  // Prefill untuk quick-add kontekstual dari baris tabel
  const [modelPrefillBrandId, setModelPrefillBrandId] = useState(null);
  const [codePrefillModelId, setCodePrefillModelId] = useState(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchKategoris(), fetchBrands(), fetchModels(), fetchCodes()]);
    setLoading(false);
  };

  const fetchKategoris = async () => {
    const { data } = await supabase.from("vehicle_kategori").select("*").order("name");
    setKategoris(data || []);
  };

  const fetchBrands = async () => {
    const { data } = await supabase.from("vehicle_brands").select("*").order("name");
    setBrands(data || []);
  };

  const fetchModels = async () => {
    const { data } = await supabase
      .from("vehicle_models")
      .select("*, vehicle_brands(name), vehicle_kategori(name)")
      .order("name");
    setModels(data || []);
  };

  const fetchCodes = async () => {
    const { data } = await supabase
      .from("vehicle_codes")
      .select("*, vehicle_models(name, vehicle_brands(name))")
      .order("code");
    setCodes(data || []);
  };

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setSearchTerm("");
  };

  const handleToggleActive = async (table, row) => {
    const { error } = await supabase
      .from(table)
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) {
      alert("Gagal memperbarui status: " + error.message);
    } else {
      fetchAll();
    }
  };

  // Hard delete dengan impact check: blokir bila masih dipakai produk,
  // tampilkan detail cascade sebelum konfirmasi.
  const handleHardDelete = async (table, row) => {
    const label = row.name || row.code;
    const detailLines = [];
    let blockedUsage = false;
    let usageCount = 0;

    if (table === "vehicle_brands") {
      const { data: childModels } = await supabase
        .from("vehicle_models")
        .select("id")
        .eq("brand_id", row.id);
      const modelIds = (childModels || []).map((m) => m.id);
      const codeCount = await countRows("vehicle_codes", "vehicle_model_id", modelIds);
      usageCount = await countRows(
        "product_vehicle_compatibilities",
        "vehicle_model_id",
        modelIds,
      );
      blockedUsage = usageCount > 0;
      detailLines.push(`${modelIds.length} tipe motor`);
      detailLines.push(`${codeCount} kode motor`);
    } else if (table === "vehicle_models") {
      const codeCount = await countRows("vehicle_codes", "vehicle_model_id", [row.id]);
      usageCount = await countRows(
        "product_vehicle_compatibilities",
        "vehicle_model_id",
        [row.id],
      );
      blockedUsage = usageCount > 0;
      detailLines.push(`${codeCount} kode motor`);
    } else if (table === "vehicle_kategori") {
      const modelCount = await countRows("vehicle_models", "vehicle_kategori_id", [row.id]);
      if (modelCount > 0) detailLines.push(`${modelCount} tipe motor kehilangan kategori (tipe tidak terhapus)`);
    } else if (table === "vehicle_codes") {
      const relCount = await countRows("product_vehicle_compatibilities", "vehicle_code_id", [row.id]);
      if (relCount > 0) detailLines.push(`${relCount} relasi kompatibilitas melepas kode ini`);
    }

    if (blockedUsage) {
      alert(
        `Tidak dapat menghapus "${label}" karena masih dipakai oleh ${usageCount} relasi kompatibilitas produk.\n\nGunakan tombol "Nonaktifkan" agar data histori produk tetap aman.`,
      );
      return;
    }

    const detailText = detailLines.length
      ? `\n\nYang akan ikut terhapus/diubah:\n- ${detailLines.join("\n- ")}`
      : "";
    if (
      !window.confirm(
        `Hapus permanen "${label}"?${detailText}\n\nJika ragu, gunakan tombol "Nonaktifkan".`,
      )
    ) {
      return;
    }
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) {
      alert("Gagal menghapus: " + friendlyDbError(error));
    } else {
      fetchAll();
    }
  };

  const openAddModelForBrand = (brandId) => {
    setModelToEdit(null);
    setModelPrefillBrandId(brandId);
    setIsModelModalOpen(true);
  };

  const openAddCodeForModel = (modelId) => {
    setCodeToEdit(null);
    setCodePrefillModelId(modelId);
    setIsCodeModalOpen(true);
  };

  const openBlankModelForm = () => {
    setModelToEdit(null);
    setModelPrefillBrandId(null);
    setIsModelModalOpen(true);
  };

  const openBlankCodeForm = () => {
    setCodeToEdit(null);
    setCodePrefillModelId(null);
    setIsCodeModalOpen(true);
  };

  const q = searchTerm.trim().toLowerCase();
  const isActiveVisible = (row) => showInactive || row.is_active !== false;

  const filteredKategoris = kategoris.filter(
    (k) => isActiveVisible(k) && `${k.name} ${k.icon || ""}`.toLowerCase().includes(q),
  );
  const filteredBrands = brands.filter(
    (b) => isActiveVisible(b) && b.name.toLowerCase().includes(q),
  );
  const filteredModels = models.filter((m) => {
    if (!isActiveVisible(m)) return false;
    const hay = `${m.name} ${m.vehicle_brands?.name || ""} ${m.vehicle_kategori?.name || ""}`.toLowerCase();
    return hay.includes(q);
  });
  const filteredCodes = codes.filter((c) => {
    if (!isActiveVisible(c)) return false;
    const hay = `${c.code} ${c.name} ${c.vehicle_models?.name || ""} ${c.vehicle_models?.vehicle_brands?.name || ""}`.toLowerCase();
    return hay.includes(q);
  });

  const tabs = [
    { id: "kategori", label: "Kategori Motor", icon: "⚙️" },
    { id: "brand", label: "Merek Motor", icon: "🏭" },
    { id: "model", label: "Tipe Motor", icon: "🏍️" },
    { id: "code", label: "Kode Motor", icon: "🔖" },
  ];

  const emptyMessages = {
    kategori:
      "Belum ada kategori motor. Klik \"+ Tambah Kategori\" untuk membuat yang pertama.",
    brand:
      "Belum ada merek motor. Klik \"+ Tambah Merek\" atau jalankan scripts/import-vehicle-data.js untuk import otomatis.",
    model:
      "Belum ada tipe motor. Tambah manual atau jalankan scripts/import-vehicle-data.js.",
    code:
      "Belum ada kode motor. Tambah manual atau jalankan scripts/import-vehicle-data.js.",
  };

  const StateRow = ({ colSpan }) =>
    loading ? (
      <tr>
        <td colSpan={colSpan} className="py-10 px-4 text-center text-slate-400 animate-pulse">
          Memuat data...
        </td>
      </tr>
    ) : (
      <tr>
        <td colSpan={colSpan} className="py-10 px-4 text-center">
          <p className="text-slate-500">{emptyMessages[activeTab]}</p>
          {(q || !showInactive) && (
            <p className="text-xs text-slate-400 mt-1">Coba ubah kata kunci atau aktifkan "Tampilkan nonaktif".</p>
          )}
        </td>
      </tr>
    );

  const ActiveBadge = ({ row }) =>
    row.is_active === false ? (
      <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold uppercase tracking-wide">
        Nonaktif
      </span>
    ) : null;

  const RowActions = ({ table, row, extraButtons = [] }) => (
    <>
      {extraButtons}
      <button
        onClick={() => handleToggleActive(table, row)}
        className={`mr-2 text-sm font-medium ${row.is_active === false ? "text-emerald-600 hover:text-emerald-800" : "text-slate-500 hover:text-slate-700"}`}
      >
        {row.is_active === false ? "Aktifkan" : "Nonaktifkan"}
      </button>
      <button
        onClick={() => {
          if (table === "vehicle_kategori") { setKategoriToEdit(row); setIsKategoriModalOpen(true); }
          if (table === "vehicle_brands") { setBrandToEdit(row); setIsBrandModalOpen(true); }
          if (table === "vehicle_models") { setModelToEdit(row); setIsModelModalOpen(true); }
          if (table === "vehicle_codes") { setCodeToEdit(row); setIsCodeModalOpen(true); }
        }}
        className="text-blue-500 hover:text-blue-700 mr-2"
      >
        Edit
      </button>
      <button onClick={() => handleHardDelete(table, row)} className="text-red-400 hover:text-red-700">
        Hapus
      </button>
    </>
  );

  const Toolbar = () => (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Cari..."
        className="p-2 border rounded text-sm w-64"
      />
      <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="rounded"
        />
        Tampilkan nonaktif
      </label>
    </div>
  );

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Manajemen Kendaraan</h1>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-orange-500 text-orange-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Kategori Tab */}
      {activeTab === "kategori" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">
              Daftar Kategori Motor{" "}
              {!loading && (
                <span className="text-sm font-normal text-slate-400">
                  ({filteredKategoris.length} ditampilkan)
                </span>
              )}
            </h2>
            <button onClick={() => { setKategoriToEdit(null); setIsKategoriModalOpen(true); }} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded">
              + Tambah Kategori
            </button>
          </div>
          <Toolbar />
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-3 px-4">Nama</th>
                  <th className="text-left py-3 px-4 w-64">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading || filteredKategoris.length === 0 ? (
                  <StateRow colSpan={2} />
                ) : (
                  filteredKategoris.map((k) => (
                    <tr key={k.id} className={`border-t ${k.is_active === false ? "opacity-50" : ""}`}>
                      <td className="py-3 px-4">
                        {k.icon} {k.name}
                        <ActiveBadge row={k} />
                      </td>
                      <td className="py-3 px-4">
                        <RowActions table="vehicle_kategori" row={k} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Brand Tab */}
      {activeTab === "brand" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">
              Daftar Merek Motor{" "}
              {!loading && (
                <span className="text-sm font-normal text-slate-400">
                  ({filteredBrands.length} ditampilkan)
                </span>
              )}
            </h2>
            <button onClick={() => { setBrandToEdit(null); setIsBrandModalOpen(true); }} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded">
              + Tambah Merek
            </button>
          </div>
          <Toolbar />
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-3 px-4">Nama</th>
                  <th className="text-left py-3 px-4 w-80">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading || filteredBrands.length === 0 ? (
                  <StateRow colSpan={2} />
                ) : (
                  filteredBrands.map((b) => (
                    <tr key={b.id} className={`border-t ${b.is_active === false ? "opacity-50" : ""}`}>
                      <td className="py-3 px-4">
                        {b.name}
                        <ActiveBadge row={b} />
                      </td>
                      <td className="py-3 px-4">
                        <RowActions
                          table="vehicle_brands"
                          row={b}
                          extraButtons={[
                            <button key="add-model" onClick={() => openAddModelForBrand(b.id)} className="text-emerald-600 hover:text-emerald-800 mr-2 text-sm font-medium">
                              + Tipe
                            </button>,
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model Tab */}
      {activeTab === "model" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">
              Daftar Tipe Motor{" "}
              {!loading && (
                <span className="text-sm font-normal text-slate-400">
                  ({filteredModels.length} ditampilkan)
                </span>
              )}
            </h2>
            <button onClick={openBlankModelForm} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded">
              + Tambah Tipe
            </button>
          </div>
          <Toolbar />
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-3 px-4">Tipe</th>
                  <th className="text-left py-3 px-4">Merek</th>
                  <th className="text-left py-3 px-4">Kategori</th>
                  <th className="text-left py-3 px-4 w-96">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading || filteredModels.length === 0 ? (
                  <StateRow colSpan={4} />
                ) : (
                  filteredModels.map((m) => (
                    <tr key={m.id} className={`border-t ${m.is_active === false ? "opacity-50" : ""}`}>
                      <td className="py-3 px-4">
                        {m.name}
                        <ActiveBadge row={m} />
                      </td>
                      <td className="py-3 px-4">{m.vehicle_brands?.name}</td>
                      <td className="py-3 px-4">{m.vehicle_kategori?.name || "-"}</td>
                      <td className="py-3 px-4">
                        <RowActions
                          table="vehicle_models"
                          row={m}
                          extraButtons={[
                            <button key="add-code" onClick={() => openAddCodeForModel(m.id)} className="text-emerald-600 hover:text-emerald-800 mr-2 text-sm font-medium">
                              + Kode
                            </button>,
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Code Tab */}
      {activeTab === "code" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">
              Daftar Kode Motor{" "}
              {!loading && (
                <span className="text-sm font-normal text-slate-400">
                  ({filteredCodes.length} ditampilkan)
                </span>
              )}
            </h2>
            <button onClick={openBlankCodeForm} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded">
              + Tambah Kode
            </button>
          </div>
          <Toolbar />
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-3 px-4">Kode</th>
                  <th className="text-left py-3 px-4">Nama</th>
                  <th className="text-left py-3 px-4">Tipe</th>
                  <th className="text-left py-3 px-4">Tahun</th>
                  <th className="text-left py-3 px-4 w-64">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading || filteredCodes.length === 0 ? (
                  <StateRow colSpan={5} />
                ) : (
                  filteredCodes.map((c) => (
                    <tr key={c.id} className={`border-t ${c.is_active === false ? "opacity-50" : ""}`}>
                      <td className="py-3 px-4 font-mono font-bold">{c.code}</td>
                      <td className="py-3 px-4">
                        {c.name}
                        <ActiveBadge row={c} />
                      </td>
                      <td className="py-3 px-4">{c.vehicle_models?.name}</td>
                      <td className="py-3 px-4">
                        {c.year_start ?? "?"} – {c.year_end ?? "sekarang"}
                      </td>
                      <td className="py-3 px-4">
                        <RowActions table="vehicle_codes" row={c} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <VehicleKategoriModal
        isOpen={isKategoriModalOpen}
        onClose={() => setIsKategoriModalOpen(false)}
        kategoriToEdit={kategoriToEdit}
        onSave={fetchAll}
      />
      <VehicleBrandModal
        isOpen={isBrandModalOpen}
        onClose={() => setIsBrandModalOpen(false)}
        brandToEdit={brandToEdit}
        onSave={fetchAll}
      />
      <VehicleModelModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        modelToEdit={modelToEdit}
        onSave={fetchAll}
        brands={brands}
        kategoris={kategoris}
        prefillBrandId={modelPrefillBrandId}
      />
      <VehicleCodeModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        codeToEdit={codeToEdit}
        onSave={fetchAll}
        models={models}
        prefillModelId={codePrefillModelId}
      />
    </div>
  );
}

export default ManajemenKendaraan;
