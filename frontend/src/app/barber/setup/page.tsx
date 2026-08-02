'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBarberSession } from '@/hooks/useBarberSession';
import { saveBarberSetup, uploadBarberAvatar } from '@/lib/barberApi';

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
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BarberSetupPage() {
  const router = useRouter();
  const { data, loading } = useBarberSession();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [targetDaily, setTargetDaily] = useState('10');
  const [targetMonthly, setTargetMonthly] = useState('250');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !data) router.replace('/barber/login');
    if (!loading && data?.profile?.setup_completed) router.replace('/barber/home');
  }, [data, loading, router]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      setAvatarPreview(dataUrl);
    } catch {
      setError('Gagal proses foto');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      let avatarUrl: string | undefined;
      if (avatarPreview) {
        const upRes = await uploadBarberAvatar(avatarPreview);
        avatarUrl = upRes.avatar_url;
      }
      await saveBarberSetup({
        target_daily: Number(targetDaily),
        target_monthly: Number(targetMonthly),
        avatar_url: avatarUrl,
      });
      router.push('/barber/home');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Gagal simpan');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) return <div className="min-h-screen flex items-center justify-center text-gray-400">Memuat...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto pt-6">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">Halo, {data.barber.name}! 👋</h1>
          <p className="text-sm text-gray-500 mt-1">Mari setup profil kamu</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 space-y-5 shadow-sm">
          <div>
            <label className="block text-sm text-gray-700 mb-2 font-medium">📸 Foto Profil</label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">👤</span>
                )}
              </div>
              <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Pilih Foto
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">Max 2MB, otomatis resize ke 400×400</p>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1 font-medium">🎯 Target Harian (customer)</label>
            <input
              type="number"
              min={1}
              value={targetDaily}
              onChange={(e) => setTargetDaily(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 caret-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              style={{ color: '#111827', WebkitTextFillColor: '#111827', opacity: 1 }}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1 font-medium">🎯 Target Bulanan (customer)</label>
            <input
              type="number"
              min={1}
              value={targetMonthly}
              onChange={(e) => setTargetMonthly(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 caret-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
              style={{ color: '#111827', WebkitTextFillColor: '#111827', opacity: 1 }}
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan & Mulai'}
          </button>
        </form>
      </div>
    </div>
  );
}
