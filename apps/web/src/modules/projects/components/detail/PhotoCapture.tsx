'use client';

import { useRef } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/modules/shared/components/ui/button';
import { captureGps } from '@/modules/projects/lib/gps';

export interface PhotoCaptureProps {
  onPhotoAdded: (blobUrl: string, gps: { lat: number; lng: number } | null) => void;
}

export function PhotoCapture({ onPhotoAdded }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    const gps = await captureGps();
    onPhotoAdded(blobUrl, gps);
    e.target.value = '';
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <Camera size={14} />
        Add Photo
      </Button>
    </>
  );
}
