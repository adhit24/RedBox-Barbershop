'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendBarberOTP, verifyBarberOTP } from '@/lib/barberApi';

export default function BarberLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [barberName, setBarberName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSendOTP(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await sendBarberOTP(phone);
      setBarberName(result.barber.name);
      setStep('otp');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal kirim OTP';
      const match = msg.match(/"error":"([^"]+)"/);
      setError(match?.[1] || msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await verifyBarberOTP(phone, code);
      if (result.setup_completed) {
        router.push('/barber/home');
      } else {
        router.push('/barber/setup');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'OTP salah';
      const match = msg.match(/"error":"([^"]+)"/);
      setError(match?.[1] || msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">💈</div>
          <h1 className="text-2xl font-bold text-white">RedBox Kapster</h1>
          <p className="text-gray-400 text-sm mt-1">
            {step === 'phone' ? 'Masukkan nomor HP yang terdaftar' : `Halo ${barberName} 👋`}
          </p>
        </div>

        {step === 'phone' ? (
          <form onSubmit={handleSendOTP} className="bg-gray-900 rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Nomor HP</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="08xxxxxxxxxx"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Mengirim OTP...' : 'Kirim Kode OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="bg-gray-900 rounded-2xl p-6 space-y-4">
            <p className="text-sm text-gray-400">
              Kami kirim kode 6 digit ke WhatsApp ke nomor {phone}
            </p>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Kode OTP</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="······"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Memverifikasi...' : 'Masuk'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              className="w-full text-sm text-gray-400 hover:text-white"
            >
              Ganti nomor HP
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
