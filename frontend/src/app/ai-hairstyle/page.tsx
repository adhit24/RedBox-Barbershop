'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { HairstyleAnalysis, AnalysisState } from './types';
import ImageUpload from './components/ImageUpload';
import HairstyleResult from './components/HairstyleResult';

const MAX_GENERATE = 3;
const COOLDOWN_SECONDS = 30;
const STORAGE_KEY = 'ai_hairstyle_count';

export default function AIHairstylePage() {
  const [state, setState] = useState<AnalysisState>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<HairstyleAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageCount, setUsageCount] = useState<number>(0);
  const [cooldown, setCooldown] = useState<number>(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const stored = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    setUsageCount(stored);
  }, []);

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const handleImageSelect = useCallback((file: File, preview: string) => {
    setSelectedFile(file);
    setPreviewUrl(preview);
    setResult(null);
    setError(null);
    setState('idle');
  }, []);

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    // Anti-spam: max 3 per session
    if (usageCount >= MAX_GENERATE) {
      setError(`Analysis limit reached (${MAX_GENERATE}x per session). Please come back later.`);
      return;
    }

    // Cooldown check
    if (cooldown > 0) return;

    setState('uploading');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      setState('analyzing');

      const res = await fetch('/api/ai-hairstyle', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || `Error ${res.status}`);
      }

      // Increment usage count
      const newCount = usageCount + 1;
      setUsageCount(newCount);
      localStorage.setItem(STORAGE_KEY, String(newCount));

      setResult(json.data);
      setState('done');
      startCooldown();
    } catch (err: unknown) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const handleReset = () => {
    setState('idle');
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
  };

  const isAnalyzing = state === 'uploading' || state === 'analyzing';
  const isLimitReached = usageCount >= MAX_GENERATE;
  const isOnCooldown = cooldown > 0;
  const remaining = MAX_GENERATE - usageCount;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background grain */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")' }}
      />

      {/* Top bar */}
      <div className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-zinc-900">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-none">RedBox</p>
              <p className="text-amber-500 text-[10px] font-medium tracking-wider uppercase leading-none mt-0.5">AI Stylist</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-zinc-400 text-xs">GPT-4o-mini</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-md mx-auto px-4 pb-12">

        {/* Hero */}
        {state === 'idle' && !result && (
          <div className="pt-8 pb-6 text-center">
            <p className="text-amber-500 text-xs font-semibold tracking-[0.3em] uppercase mb-3">AI-Powered</p>
            <h1 className="text-3xl font-bold leading-tight mb-3">
              Find Your<br />
              <span className="text-amber-400">Perfect Cut</span>
            </h1>
            <p className="text-zinc-500 text-sm leading-relaxed max-w-xs mx-auto">
              Upload your portrait and our AI will analyze your face shape and hair to recommend the best styles for you.
            </p>
          </div>
        )}

        {/* Upload + Analyze — shown when not done */}
        {state !== 'done' && (
          <div className={`space-y-4 ${state !== 'idle' ? 'pt-6' : ''}`}>
            <ImageUpload
              onImageSelect={handleImageSelect}
              state={state}
              previewUrl={previewUrl}
            />

            {/* Error */}
            {error && (
              <div className="bg-red-950/40 border border-red-500/30 rounded-2xl p-4 text-center">
                <p className="text-red-400 text-sm">{error}</p>
                <button onClick={() => setError(null)} className="text-red-500/70 text-xs mt-1 underline">
                  Dismiss
                </button>
              </div>
            )}

            {/* Usage counter */}
            {usageCount > 0 && !isLimitReached && (
              <div className="flex items-center justify-between px-1">
                <p className="text-zinc-500 text-xs">Session usage</p>
                <div className="flex gap-1">
                  {Array.from({ length: MAX_GENERATE }).map((_, i) => (
                    <span key={i} className={`w-2 h-2 rounded-full ${i < usageCount ? 'bg-amber-500' : 'bg-zinc-700'}`} />
                  ))}
                </div>
              </div>
            )}

            {/* Analyze button */}
            {selectedFile && !isAnalyzing && (
              <>
                {isLimitReached ? (
                  <div className="w-full py-4 bg-zinc-900 border border-zinc-700 rounded-2xl text-center">
                    <p className="text-zinc-400 text-sm font-medium">Daily limit reached ({MAX_GENERATE}/{MAX_GENERATE})</p>
                    <p className="text-zinc-600 text-xs mt-1">Come back in a new session</p>
                  </div>
                ) : isOnCooldown ? (
                  <button disabled className="w-full py-4 bg-zinc-900 border border-zinc-700 rounded-2xl flex items-center justify-center gap-2 cursor-not-allowed">
                    <div className="w-4 h-4 border-2 border-zinc-600 border-t-amber-500 rounded-full animate-spin" />
                    <span className="text-zinc-400 text-sm font-medium">Cooldown {cooldown}s</span>
                  </button>
                ) : (
                  <button
                    onClick={handleAnalyze}
                    className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-2xl transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Analyze My Hair
                    {remaining < MAX_GENERATE && (
                      <span className="text-black/60 text-xs font-normal">({remaining} left)</span>
                    )}
                  </button>
                )}
              </>
            )}

            {/* Analyzing state */}
            {isAnalyzing && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className="w-2 h-2 bg-amber-500 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
                <p className="text-white font-medium text-sm mb-1">
                  {state === 'uploading' ? 'Processing image...' : 'AI analyzing your hair...'}
                </p>
                <p className="text-zinc-500 text-xs">This takes about 5-10 seconds</p>
              </div>
            )}

            {/* Features hint — only on idle empty state */}
            {!selectedFile && (
              <div className="grid grid-cols-3 gap-2 pt-2">
                {[
                  { icon: '🔬', label: 'Face Analysis' },
                  { icon: '✂️', label: 'Style Match' },
                  { icon: '💡', label: 'Pro Tips' },
                ].map((f) => (
                  <div key={f.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                    <p className="text-xl mb-1">{f.icon}</p>
                    <p className="text-zinc-400 text-xs">{f.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {state === 'done' && result && previewUrl && (
          <div className="pt-6">
            <HairstyleResult
              data={result}
              previewUrl={previewUrl}
              onReset={handleReset}
            />
          </div>
        )}
      </div>
    </div>
  );
}
