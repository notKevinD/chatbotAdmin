"use client";

import { useEffect, useState } from "react";
import { AdminUserRow, CurrentAdminInfo } from "@/app/admin/types";
import { fetchJson, formatIndonesianDateTime } from "@/app/admin/utils";
import { TableSkeleton } from "@/app/admin/shared";

export function AdminManagementSection() {
  const [admins, setAdmins] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "admin" });
  const [passwordTarget, setPasswordTarget] = useState<AdminUserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<CurrentAdminInfo | null>(null);
  const isSuperAdmin = currentAdmin?.role === "super_admin";

  useEffect(() => {
    fetchJson<{ admin: CurrentAdminInfo }>("/api/auth/session")
      .then((data) => setCurrentAdmin(data.admin))
      .catch(() => undefined);
  }, []);

  async function loadAdmins() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<{ admins: AdminUserRow[] }>("/api/admin/manage-admins");
      setAdmins(data.admins || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat daftar admin.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdmins();
  }, []);

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/admin/manage-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setMessage(`Admin ${form.email} berhasil dibuat.`);
      setForm({ email: "", password: "", name: "", role: "admin" });
      setIsFormOpen(false);
      await loadAdmins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat akun admin.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(admin: AdminUserRow) {
    const nextActive = !admin.is_active;
    const confirmed = window.confirm(
      nextActive
        ? `Aktifkan kembali akun ${admin.email}?`
        : `Nonaktifkan akun ${admin.email}? Admin ini tidak akan bisa login sampai diaktifkan lagi.`,
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    try {
      await fetchJson("/api/admin/manage-admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: admin.id, isActive: nextActive }),
      });
      setMessage(`Status akun ${admin.email} berhasil diubah.`);
      await loadAdmins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status admin.");
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordTarget) return;

    setPasswordSubmitting(true);
    setError("");
    setMessage("");
    try {
      await fetchJson("/api/admin/manage-admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: passwordTarget.id, password: newPassword }),
      });
      setMessage(`Password akun ${passwordTarget.email} berhasil diganti. Semua sesi login akun ini otomatis logout.`);
      setPasswordTarget(null);
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengganti password admin.");
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function deleteAdmin(admin: AdminUserRow) {
    const confirmed = window.confirm(
      `Hapus permanen akun ${admin.email}? Tindakan ini tidak bisa dibatalkan.`,
    );
    if (!confirmed) return;

    setError("");
    setMessage("");
    setDeletingId(admin.id);
    try {
      await fetchJson("/api/admin/manage-admins", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: admin.id }),
      });
      setMessage(`Akun ${admin.email} berhasil dihapus.`);
      await loadAdmins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus akun admin.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800">Kelola Akun Admin</h2>
          <p className="text-xs text-slate-500">
            {isSuperAdmin
              ? "Tambah, lihat, atau nonaktifkan akun admin panel ini."
              : "Lihat daftar admin. Kamu hanya bisa mengganti password akunmu sendiri."}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm"
            onClick={() => setIsFormOpen((prev) => !prev)}
            type="button"
          >
            {isFormOpen ? "Batal" : "+ Tambah Admin"}
          </button>
        )}
      </div>

      {error && (
        <div className="m-4 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-lg text-sm">{error}</div>
      )}
      {message && (
        <div className="m-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
          {message}
        </div>
      )}

      {isSuperAdmin && isFormOpen && (
        <form onSubmit={handleCreateAdmin} className="p-5 border-b border-slate-100 bg-slate-50/30 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Email</label>
              <input
                type="email"
                required
                className="border border-slate-300 rounded-lg p-2 text-sm"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Password (min. 8 karakter)</label>
              <input
                type="password"
                required
                minLength={8}
                className="border border-slate-300 rounded-lg p-2 text-sm"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Nama (opsional)</label>
              <input
                type="text"
                className="border border-slate-300 rounded-lg p-2 text-sm"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Role</label>
              <input
                type="text"
                className="border border-slate-300 rounded-lg p-2 text-sm"
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold shadow-sm"
          >
            {submitting ? "Menyimpan..." : "Buat Akun Admin"}
          </button>
        </form>
      )}

      {loading && !admins.length ? (
        <TableSkeleton rows={3} columns={4} />
      ) : admins.length ? (
        <ul className="divide-y divide-slate-100">
          {admins.map((admin) => (
            <li key={admin.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {admin.name || admin.email}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {admin.email} · {admin.role || "admin"} · dibuat {formatIndonesianDateTime(admin.created_at)}
                </p>
              </div>
              <span
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${
                  admin.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                }`}
              >
                {admin.is_active ? "Aktif" : "Nonaktif"}
              </span>
              <div className="shrink-0 flex items-center gap-2">
                {isSuperAdmin && !(admin.id === currentAdmin?.id && admin.is_active) && (
                  <button
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50"
                    onClick={() => toggleActive(admin)}
                    type="button"
                  >
                    {admin.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                )}
                {(isSuperAdmin || admin.id === currentAdmin?.id) && (
                  <button
                    className="px-3 py-1.5 border border-indigo-300 text-indigo-600 rounded-lg text-xs font-semibold hover:bg-indigo-50"
                    onClick={() => {
                      setPasswordTarget(admin);
                      setNewPassword("");
                    }}
                    type="button"
                  >
                    Ganti Password
                  </button>
                )}
                {isSuperAdmin && admin.id !== currentAdmin?.id && (
                  <button
                    className="px-3 py-1.5 border border-rose-300 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50 disabled:opacity-50"
                    onClick={() => deleteAdmin(admin)}
                    disabled={deletingId === admin.id}
                    type="button"
                  >
                    {deletingId === admin.id ? "Menghapus..." : "Hapus"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-12 text-center text-sm text-slate-400">Belum ada data admin.</div>
      )}

      {passwordTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800">Ganti Password</h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate">Akun: {passwordTarget.email}</p>
            </div>
            <form onSubmit={handleResetPassword} className="p-5 space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Password baru (min. 8 karakter)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  className="border border-slate-300 rounded-lg p-2 text-sm"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Semua sesi login yang sedang aktif untuk akun ini akan otomatis logout setelah password diganti.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="px-3 py-2 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-100"
                  onClick={() => {
                    setPasswordTarget(null);
                    setNewPassword("");
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={passwordSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm"
                >
                  {passwordSubmitting ? "Menyimpan..." : "Simpan Password Baru"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}