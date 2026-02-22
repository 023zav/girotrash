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
  const inputRef = useRef<HTMLInputElement>(null);
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
      if (inputRef.current) inputRef.current.value = '';
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

        {canAddMore && (
          <label className="photo-add-btn">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleFiles}
              disabled={compressing}
            />
            {compressing ? (
              <>
                <div className="spinner dark" />
                <span>{t('photos.compressing')}</span>
              </>
            ) : (
              <>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>{t('photos.add')}</span>
              </>
            )}
          </label>
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
