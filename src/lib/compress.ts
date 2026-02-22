import imageCompression from 'browser-image-compression';
import { PHOTO_CONFIG } from './constants';

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  previewUrl: string;
}

/**
 * Compress a photo file to <= 1 MB JPEG.
 * Uses browser-image-compression library for reliable cross-browser support.
 */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const originalSize = file.size;

  const compressed = await imageCompression(file, {
    maxSizeMB: PHOTO_CONFIG.maxSizeBytes / (1024 * 1024),
    maxWidthOrHeight: PHOTO_CONFIG.maxDimension,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: PHOTO_CONFIG.quality,
  });

  // Get dimensions from the compressed image
  const { width, height } = await getImageDimensions(compressed);

  const previewUrl = URL.createObjectURL(compressed);

  return {
    blob: compressed,
    width,
    height,
    originalSize,
    compressedSize: compressed.size,
    previewUrl,
  };
}

function getImageDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Revoke all preview URLs to free memory.
 */
export function revokePhotoPreviews(photos: CompressedPhoto[]) {
  photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
}
