'use client';
import { useState } from 'react';
import { useBarberSession } from '@/hooks/useBarberSession';
import { updateBarberTarget, uploadBarberAvatar } from '@/lib/barberApi';

async function resizeImage(file: File, maxSize = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
        else      { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BarberProfilePage() {
  const { data: session, refresh, signOut } = useBarberSession();
  const [editingTarget, setEditingTarget] = useState(false);
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  if (!session?.profile) return null;

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      await uploadBarberAvatar(dataUrl);
      await refresh();
      setMsg('Foto profil diupdate ✓');
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('Gagal upload foto');
    }
  }

  async function handleSaveTarget() {
    setSaving(true);
    try {
      await updateBarberTarget(Number(daily), Number(monthly));
      await refresh();
      setEditingTarget(false);
      setMsg('Target diupdate ✓');
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('Gagal simpan target');
    } finally {
      setSaving(false);
    }
  }

  function startEditTarget() {
    setDaily(String(session?.profile?.target_daily ?? 10));
    setMonthly(String(session?.profile?.target_monthly ?? 250));
    setEditingTarget(true);
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Saya</h2>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center gap-4">
        {session.profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.profile.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-2xl">👤</div>
        )}
        <div className="flex-1">
          <p className="font-bold text-gray-900">{session.barber.name}</p>
          <p className="text-sm text-gray-500 capitalize">💈 {session.barber.branch}</p>
          <p className="text-xs text-gray-400 mt-1">{session.profile.phone}</p>
        </div>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-900">🎯 Target</h3>
          {!editingTarget && (
            <button onClick={startEditTarget} className="text-sm text-red-600 hover:underline">
              Ubah
            </button>
          )}
        </div>
        {editingTarget ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Harian</label>
              <input
                type="number"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Bulanan</label>
              <input
                type="number"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveTarget}
                disabled={saving}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                onClick={() => setEditingTarget(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-gray-700"
              >
                Batal
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <p>Harian: <span className="font-semibold">{session.profile.target_daily} customer</span></p>
            <p>Bulanan: <span className="font-semibold">{session.profile.target_monthly} customer</span></p>
          </div>
        )}
      </div>

      <label className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors">
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-700">📸 Ganti Foto Profil</span>
          <span className="text-gray-400">›</span>
        </div>
        <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
      </label>

      <button
        onClick={signOut}
        className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left font-medium text-red-600 hover:bg-red-50 transition-colors"
      >
        🚪 Keluar
      </button>
    </div>
  );
}
