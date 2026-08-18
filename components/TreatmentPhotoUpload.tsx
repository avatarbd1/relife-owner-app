"use client";

import { useState, useRef } from "react";
import { Spinner, StatusBadge } from "@/components/FeedbackUI";
import { useToastContext } from "@/components/ToastContext";
import { haptic } from "@/lib/interactions";

interface TreatmentPhotoUploadProps {
  patientId: string;
  sessionId?: string;
  onPhotoAdded?: (photoId: string, photoUrl: string) => void;
  disabled?: boolean;
}

interface Photo {
  id: string;
  url: string;
  uploadedAt: string;
  size: number;
}

export default function TreatmentPhotoUpload({
  patientId,
  sessionId,
  onPhotoAdded,
  disabled = false,
}: TreatmentPhotoUploadProps) {
  const { addToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file
    if (!file.type.startsWith("image/")) {
      addToast("Please select an image file", "error");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      addToast("Image must be smaller than 10 MB", "error");
      return;
    }

    setUploading(true);
    haptic("tap");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patientId", patientId);
      if (sessionId) {
        formData.append("sessionId", sessionId);
      }

      const response = await fetch("/api/patients/treatment-photo", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload photo");
      }

      const data = await response.json();
      setPhotos([...photos, data.photo]);
      onPhotoAdded?.(data.photo.id, data.photo.url);

      addToast("Photo uploaded successfully", "success");
      haptic("success");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload photo";
      addToast(message, "error");
      haptic("error");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemovePhoto(photoId: string) {
    if (!confirm("Remove this photo from treatment record?")) return;

    try {
      const response = await fetch(`/api/patients/treatment-photo/${photoId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to remove photo");
      }

      setPhotos(photos.filter((p) => p.id !== photoId));
      addToast("Photo removed", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove photo";
      addToast(message, "error");
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3">
        <p className="text-xs font-semibold text-slate-600">Treatment Photos</p>
        <p className="mt-0.5 text-[10px] text-slate-500">Add photos to document treatment progress</p>
      </div>

      {photos.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <img
                src={photo.url}
                alt="Treatment photo"
                className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemovePhoto(photo.id)}
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-900/80 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <span className="text-white text-sm font-bold">✕</span>
              </button>
              <div className="mt-1 text-[9px] text-slate-500 truncate">
                {(photo.size / 1024).toFixed(1)} KB
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          disabled={uploading || disabled}
          accept="image/*"
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || disabled}
          className="flex items-center justify-center gap-2 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading && <Spinner size="xs" className="border-slate-400 border-t-slate-700" />}
          {uploading ? "Uploading..." : "📷 Add Photo"}
        </button>
      </div>

      {photos.length > 0 && (
        <div className="mt-3 text-[10px] text-slate-500">
          {photos.length} photo{photos.length !== 1 ? "s" : ""} attached to treatment
        </div>
      )}
    </div>
  );
}
