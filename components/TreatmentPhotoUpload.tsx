"use client";

import { useState, useRef } from "react";
import { haptic } from "@/lib/interactions";
import Image from "next/image";

interface Photo {
  id: string;
  file: File;
  preview: string;
  altText: string;
}

export default function TreatmentPhotoUpload({
  onPhotosChange,
  maxPhotos = 5,
}: {
  onPhotosChange: (photos: Photo[]) => void;
  maxPhotos?: number;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragOverRef = useRef(false);

  function compressImage(file: File): Promise<File> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new window.Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxWidth = 1200;
          const maxHeight = 1200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            const compressedFile = new File([blob!], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          }, "image/jpeg", 0.85);
        };
      };
    });
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;

    const remainingSlots = maxPhotos - photos.length;
    const filesToAdd = Array.from(files).slice(0, remainingSlots);

    setUploading(true);
    try {
      const newPhotos: Photo[] = [];
      for (const file of filesToAdd) {
        if (!file.type.startsWith("image/")) continue;

        const compressed = await compressImage(file);
        const preview = URL.createObjectURL(compressed);
        newPhotos.push({
          id: `photo-${Date.now()}-${Math.random()}`,
          file: compressed,
          preview,
          altText: "",
        });
      }

      const updated = [...photos, ...newPhotos];
      setPhotos(updated);
      onPhotosChange(updated);
      haptic("success");
    } catch (err) {
      haptic("error");
      console.error("Photo compression failed:", err);
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(id: string) {
    const updated = photos.filter((p) => p.id !== id);
    setPhotos(updated);
    onPhotosChange(updated);
    haptic("success");
  }

  function updateAltText(id: string, altText: string) {
    const updated = photos.map((p) =>
      p.id === id ? { ...p, altText } : p
    );
    setPhotos(updated);
    onPhotosChange(updated);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <label className="block text-sm font-semibold text-slate-900">
          📸 Treatment Photos
        </label>
        <p className="text-xs text-slate-500">
          Upload up to {maxPhotos} photos (auto-compressed)
        </p>
      </div>

      {/* Upload Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          dragOverRef.current = true;
        }}
        onDragLeave={() => {
          dragOverRef.current = false;
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragOverRef.current = false;
          handleFilesSelected(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition ${
          dragOverRef.current
            ? "border-blue-400 bg-blue-50"
            : "border-slate-300 bg-slate-50"
        } ${photos.length >= maxPhotos ? "opacity-50" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          disabled={photos.length >= maxPhotos || uploading}
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="hidden"
        />
        <button
          type="button"
          disabled={photos.length >= maxPhotos || uploading}
          onClick={() => fileInputRef.current?.click()}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
        >
          {uploading ? "Compressing..." : "Click to upload or drag photos here"}
        </button>
        <p className="mt-1 text-[11px] text-slate-500">
          {photos.length} / {maxPhotos} photos
        </p>
      </div>

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="space-y-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                <img
                  src={photo.preview}
                  alt={photo.altText || "Treatment photo"}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  className="absolute right-1 top-1 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                placeholder="Alt text (e.g., 'Before')"
                value={photo.altText}
                onChange={(e) => updateAltText(photo.id, e.target.value)}
                maxLength={50}
                className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
