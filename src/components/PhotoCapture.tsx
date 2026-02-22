import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compressPhoto, type CompressedPhoto } from '../lib/compress';
import { PHOTO_CONFIG } from '../lib/constants';

interface Props {
  photos: CompressedPhoto[];
  onPhotosChange: (photos: CompressedPhoto[]) => void;
}

export default function PhotoCapture({ photos, onPhotosChange }: Props) {
  const { t } = useTranslation();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [compressing, setCompressing] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const remaining = PHOTO_CONFIG.maxCount - photos.length;
    const toProcess = Array.from(files).slice(0, remaining);

    setCompressing(true);
    try {
      const newPhotos: CompressedPhoto[] = [];
      for (const file of toProcess) {
        const compressed = await compressPhoto(file);
        newPhotos.push(compressed);
      }
      onPhotosChange([...photos, ...newPhotos]);
    } catch (err) {
      console.error('Compression error:', err);
    } finally {
      setCompressing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  }

  function removePhoto(index: number) {
    const updated = [...photos];
    URL.revokeObjectURL(updated[index].previewUrl);
    updated.splice(index, 1);
    onPhotosChange(updated);
  }

  const canAddMore = photos.length < PHOTO_CONFIG.maxCount;

  return (
    <div>
      <div className="photo-grid">
        {photos.map((photo, i) => (
          <div key={i} className="photo-card">
            <img src={photo.previewUrl} alt={`Photo ${i + 1}`} />
            <button
              className="remove-btn"
              onClick={() => removePhoto(i)}
              aria-label={t('photos.remove')}
            >
              &times;
            </button>
          </div>
        ))}

        {canAddMore && !compressing && (
          <>
            {/* Take photo with camera */}
            <label className="photo-add-btn">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFiles}
                disabled={compressing}
              />
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>{t('photos.takePhoto')}</span>
            </label>

            {/* Choose from gallery */}
            <label className="photo-add-btn">
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFiles}
                disabled={compressing}
              />
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>{t('photos.fromGallery')}</span>
            </label>
          </>
        )}

        {compressing && canAddMore && (
          <div className="photo-add-btn" style={{ cursor: 'default' }}>
            <div className="spinner dark" />
            <span>{t('photos.compressing')}</span>
          </div>
        )}
      </div>

      <p
        style={{
          marginTop: 12,
          fontSize: 13,
          color: 'var(--c-text-secondary)',
          textAlign: 'center',
        }}
      >
        {t('photos.count', { count: photos.length })}
      </p>
    </div>
  );
}
