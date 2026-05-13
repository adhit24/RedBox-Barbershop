'use client';

import { useCallback, useRef, useState } from 'react';
import { AnalysisState } from '../types';

interface Props {
  onImageSelect: (file: File, previewUrl: string) => void;
  state: AnalysisState;
  previewUrl: string | null;
}

function compressImage(file: File, maxWidth = 768, quality = 0.75): Promise<File> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(compressed);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export default function ImageUpload({ onImageSelect, state, previewUrl }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDisabled = state === 'uploading' || state === 'analyzing';

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const compressed = await compressImage(file);
    const preview = URL.createObjectURL(compressed);
    onImageSelect(compressed, preview);
  }, [onImageSelect]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isDisabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile, isDisabled]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); if (!isDisabled) setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full">
      <div
        onClick={() => !isDisabled && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`
          relative w-full rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden
          ${isDragging ? 'border-amber-400 bg-amber-400/5 scale-[1.01]' : 'border-zinc-700 hover:border-amber-500/60'}
          ${isDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}
          ${previewUrl ? 'aspect-square' : 'aspect-[4/3]'}
        `}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Uploaded portrait"
              className="w-full h-full object-cover"
            />
            {isDisabled && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-amber-400 text-sm font-medium tracking-widest uppercase">
                  {state === 'uploading' ? 'Processing...' : 'Analyzing...'}
                </p>
              </div>
            )}
            {!isDisabled && (
              <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="text-center">
                  <svg className="w-8 h-8 text-white mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-white text-sm">Change photo</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isDragging ? 'bg-amber-400/20' : 'bg-zinc-800'}`}>
              <svg className={`w-8 h-8 transition-colors ${isDragging ? 'text-amber-400' : 'text-zinc-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white font-medium mb-1">
                {isDragging ? 'Drop your photo here' : 'Upload your portrait'}
              </p>
              <p className="text-zinc-500 text-sm">Drag & drop or click to browse</p>
              <p className="text-zinc-600 text-xs mt-2">JPG, PNG, WEBP — Max 5MB</p>
            </div>
            <div className="flex gap-2 text-xs text-zinc-600">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Face visible
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Good lighting
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Front-facing
              </span>
            </div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onInputChange}
        disabled={isDisabled}
      />
    </div>
  );
}
