import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { FiPlus, FiEdit, FiTrash2, FiImage } from "react-icons/fi";
import PromoModal from "../components/PromoModal";

const formatDate = (dateString) => {
  if (!dateString) return "-";
  // Tampilkan selalu dalam WIB (Asia/Jakarta) agar konsisten dengan input,
  // terlepas dari zona waktu browser admin.
  return new Date(dateString).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const MAX_PROMOS = 7;

const PromoBanners = () => {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [promoToEdit, setPromoToEdit] = useState(null);

  const fetchPromos = async () => {
    const { data, error } = await supabase
      .from("promos")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Gagal memuat promo:", error);
    } else {
      setPromos(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPromos();
  }, []);

  const handleAdd = () => {
    if (promos.length >= MAX_PROMOS) {
      alert(`Maksimal ${MAX_PROMOS} promo. Hapus promo yang tidak diperlukan terlebih dahulu.`);
      return;
    }
    setPromoToEdit(null);
    setIsModalOpen(true);
  };

  const handleEdit = (promo) => {
    setPromoToEdit(promo);
    setIsModalOpen(true);
  };

  const handleDelete = async (promo) => {
    if (!window.confirm(`Hapus promo "${promo.title}"?`)) return;

    const { error } = await supabase
      .from("promos")
      .delete()
      .eq("id", promo.id);

    if (error) {
      alert("Gagal menghapus promo: " + error.message);
    } else {
      fetchPromos();
    }
  };

  const handleSave = async (promoData) => {
    const isEdit = Boolean(promoData.id);

    let result;
    if (isEdit) {
      const { id, created_at, ...updateData } = promoData;
      result = await supabase
        .from("promos")
        .update(updateData)
        .eq("id", promoData.id);
    } else {
      const { id, created_at, ...insertData } = promoData;
      result = await supabase.from("promos").insert(insertData);
    }

    if (result.error) {
      alert(`Gagal ${isEdit ? "memperbarui" : "menambah"} promo: ${result.error.message}`);
    } else {
      setIsModalOpen(false);
      fetchPromos();
    }
  };

  const renderStatus = (promo) => {
    if (!promo.is_active) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-500">
          Tidak Aktif
        </span>
      );
    }

    const now = new Date();
    const validFrom = promo.valid_from ? new Date(promo.valid_from) : null;
    const validUntil = promo.valid_until ? new Date(promo.valid_until) : null;

    if (validFrom && validFrom > now) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
          Terjadwal
        </span>
      );
    }
    if (validUntil && validUntil < now) {
      return (
        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
          Kedaluwarsa
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
        Aktif
      </span>
    );
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Manajemen Promo</h1>
          <p className="text-slate-500 text-sm mt-1">
            Kelola banner promo yang tampil di halaman utama toko online.
            {promos.length}/{MAX_PROMOS} slot terpakai.
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={promos.length >= MAX_PROMOS}
          className="flex items-center gap-2 bg-blue-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiPlus />
          <span>Tambah Promo</span>
        </button>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-lg shadow-md overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 uppercase">
            <tr>
              <th className="px-4 py-3">Gambar</th>
              <th className="px-6 py-3">Judul</th>
              <th className="px-6 py-3">Urutan</th>
              <th className="px-6 py-3">Berlaku Sampai</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" className="text-center p-6">
                  Memuat data...
                </td>
              </tr>
            ) : promos.length === 0 ? (
              <tr>
                <td colSpan="6" className="text-center p-6">
                  <FiImage className="mx-auto text-4xl text-slate-300 mb-2" />
                  <p className="text-slate-500">Belum ada promo yang dibuat.</p>
                </td>
              </tr>
            ) : (
              promos.map((promo) => (
                <tr key={promo.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {promo.image_url ? (
                      <img
                        src={promo.image_url}
                        alt={promo.title}
                        className="w-20 h-12 object-cover rounded border"
                      />
                    ) : (
                      <div
                        className={`w-20 h-12 rounded border bg-gradient-to-r ${promo.bg_gradient}`}
                      />
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold">{promo.title}</p>
                    <p className="text-xs text-slate-400 truncate max-w-[200px]">
                      {promo.subtitle || "-"}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-center">{promo.sort_order}</td>
                  <td className="px-6 py-4">
                    {formatDate(promo.valid_until)}
                  </td>
                  <td className="px-6 py-4">{renderStatus(promo)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleEdit(promo)}
                        className="text-blue-600 hover:text-blue-800"
                        title="Edit"
                      >
                        <FiEdit />
                      </button>
                      <button
                        onClick={() => handleDelete(promo)}
                        className="text-red-600 hover:text-red-800"
                        title="Hapus"
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <p className="text-center p-6 text-slate-500">Memuat data...</p>
        ) : promos.length === 0 ? (
          <div className="text-center p-6 bg-white rounded-lg shadow">
            <FiImage className="mx-auto text-4xl text-slate-300 mb-2" />
            <p className="text-slate-500">Belum ada promo.</p>
          </div>
        ) : (
          promos.map((promo) => (
            <div key={promo.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex gap-3">
                {promo.image_url ? (
                  <img
                    src={promo.image_url}
                    alt={promo.title}
                    className="w-20 h-14 object-cover rounded border flex-shrink-0"
                  />
                ) : (
                  <div
                    className={`w-20 h-14 rounded border bg-gradient-to-r ${promo.bg_gradient} flex-shrink-0`}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{promo.title}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {promo.subtitle || "-"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {renderStatus(promo)}
                    <span className="text-xs text-slate-400">
                      Urutan: {promo.sort_order}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-3 pt-3 border-t">
                <button
                  onClick={() => handleEdit(promo)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                >
                  <FiEdit /> Edit
                </button>
                <button
                  onClick={() => handleDelete(promo)}
                  className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center gap-1"
                >
                  <FiTrash2 /> Hapus
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <PromoModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        promoToEdit={promoToEdit}
      />
    </div>
  );
};

export default PromoBanners;
