'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendBarberOTP, verifyBarberOTP } from '@/lib/barberApi';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Phone, ArrowRight, Loader2, RotateCcw } from 'lucide-react';

const ease = [0.16, 1, 0.3, 1] as const;

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

  function resetToPhone() {
    setStep('phone');
    setCode('');
    setError('');
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5 relative overflow-hidden"
      style={{ background: '#070508' }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 80% 45% at 50% -5%, rgba(200,30,20,0.13) 0%, transparent 70%)',
        }}
      />
      {/* Noise */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
        }}
      />

      <div className="w-full max-w-[360px] relative z-10">
        {/* Brand header */}
        <motion.div
          className="flex flex-col items-center mb-10"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <div className="w-20 h-20 mb-5 relative">
            <Image
              src="/redbox-logo.png"
              alt="RedBox"
              fill
              className="object-contain"
              priority
            />
          </div>
          <p
            className="text-[11px] tracking-[0.28em] font-semibold uppercase"
            style={{ color: '#7A6A6D' }}
          >
            Portal Kapster
          </p>
          <div
            className="mt-4 w-10 h-px"
            style={{ background: 'rgba(200,30,20,0.5)' }}
          />
        </motion.div>

        {/* Step indicator */}
        <motion.div
          className="flex items-center justify-center gap-2 mb-7"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {(['phone', 'otp'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300"
                style={{
                  background: step === s || (s === 'phone' && step === 'otp')
                    ? '#C72820'
                    : '#1C1416',
                  color: step === s || (s === 'phone' && step === 'otp')
                    ? '#FFF0EF'
                    : '#4A3E40',
                  border: step === s ? '1px solid #C72820' : '1px solid #261E20',
                }}
              >
                {i + 1}
              </div>
              {i === 0 && (
                <div
                  className="w-8 h-px transition-all duration-300"
                  style={{ background: step === 'otp' ? '#C72820' : '#261E20' }}
                />
              )}
            </div>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">
          {step === 'phone' ? (
            <motion.form
              key="phone"
              onSubmit={handleSendOTP}
              className="flex flex-col gap-4"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease }}
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="phone"
                  className="text-[11px] tracking-[0.12em] uppercase font-semibold"
                  style={{ color: '#5A4E50' }}
                >
                  Nomor HP
                </label>
                <div className="relative">
                  <Phone
                    size={14}
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: '#4A3E40' }}
                  />
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    required
                    placeholder="08xxxxxxxxxx"
                    className="w-full rounded-xl pl-10 pr-4 py-3.5 text-sm outline-none transition-all duration-200 placeholder:text-[#3A3033]"
                    style={{
                      background: '#130E10',
                      border: '1px solid #261E20',
                      color: '#F0EAEB',
                    }}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = '#C72820';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(199,40,32,0.10)';
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = '#261E20';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-xs font-medium rounded-lg px-3.5 py-2.5"
                    style={{
                      background: 'rgba(199,40,32,0.12)',
                      border: '1px solid rgba(199,40,32,0.25)',
                      color: '#F07068',
                    }}
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold tracking-wide transition-all duration-200 mt-1 disabled:opacity-60"
                style={{ background: '#C72820', color: '#FFF0EF' }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : (
                  <><span>Kirim Kode OTP</span><ArrowRight size={15} /></>
                )}
              </motion.button>
            </motion.form>
          ) : (
            <motion.form
              key="otp"
              onSubmit={handleVerify}
              className="flex flex-col gap-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.4, ease }}
            >
              {/* Greeting */}
              <div
                className="rounded-xl px-4 py-3 flex items-center gap-3"
                style={{ background: '#130E10', border: '1px solid #261E20' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'rgba(199,40,32,0.15)', color: '#E87068' }}
                >
                  {barberName[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: '#F0EAEB' }}>
                    Halo, {barberName}
                  </p>
                  <p className="text-xs" style={{ color: '#5A4E50' }}>
                    Kode dikirim ke {phone}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="otp"
                  className="text-[11px] tracking-[0.12em] uppercase font-semibold"
                  style={{ color: '#5A4E50' }}
                >
                  Kode OTP
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  placeholder="······"
                  className="w-full rounded-xl px-4 py-4 text-center text-2xl tracking-[0.5em] outline-none transition-all duration-200 placeholder:text-[#3A3033] placeholder:tracking-widest"
                  style={{
                    background: '#130E10',
                    border: '1px solid #261E20',
                    color: '#F0EAEB',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = '#C72820';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(199,40,32,0.10)';
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = '#261E20';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-xs font-medium rounded-lg px-3.5 py-2.5"
                    style={{
                      background: 'rgba(199,40,32,0.12)',
                      border: '1px solid rgba(199,40,32,0.25)',
                      color: '#F07068',
                    }}
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold tracking-wide transition-all duration-200 mt-1 disabled:opacity-60"
                style={{ background: '#C72820', color: '#FFF0EF' }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : (
                  <><span>Verifikasi</span><ArrowRight size={15} /></>
                )}
              </motion.button>

              <button
                type="button"
                onClick={resetToPhone}
                className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors"
                style={{ color: '#4A3E40' }}
              >
                <RotateCcw size={12} />
                Ganti nomor HP
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <motion.p
          className="text-center text-[10px] mt-8"
          style={{ color: '#3A3033' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          RedBox Barbershop &mdash; Internal System
        </motion.p>
      </div>
    </div>
  );
}
