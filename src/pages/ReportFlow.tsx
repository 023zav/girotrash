import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageBar from '../components/LanguageBar';
import MapView from '../components/MapView';
import PhotoCapture from '../components/PhotoCapture';
import { Trans } from 'react-i18next';
import type { CompressedPhoto } from '../lib/compress';
import type { ReportCategory } from '../types';
import { revokePhotoPreviews } from '../lib/compress';
import { isInsideServiceArea, getDeviceId } from '../lib/constants';
import { createReport, uploadPhoto, reverseGeocode } from '../lib/api';
import { saveLocalReport } from '../lib/local-reports';

type Step = 'map' | 'photos' | 'details' | 'confirm';

export default function ReportFlow() {
  const { t } = useTranslation();

  // Flow state
  const [step, setStep] = useState<Step>('map');

  // Report data
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [photos, setPhotos] = useState<CompressedPhoto[]>([]);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [honeypot, setHoneypot] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');

  const handleLocationSelect = useCallback(
    (newLat: number, newLon: number) => {
      setLat(newLat);
      setLon(newLon);
      // Fire-and-forget reverse geocode
      reverseGeocode(newLat, newLon).then((addr) => {
        if (addr) setAddress(addr);
      });
    },
    []
  );

  function canContinueFromMap() {
    return lat != null && lon != null && isInsideServiceArea(lat, lon);
  }

  function canContinueFromPhotos() {
    return photos.length > 0;
  }

  async function handleSubmit() {
    if (!lat || !lon) {
      setError(t('errors.noLocation'));
      return;
    }
    if (photos.length === 0) {
      setError(t('errors.noPhotos'));
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // 1. Create report and get upload URLs
      const result = await createReport({
        lat,
        lon,
        description: description.trim(),
        category: category!,
        photo_count: photos.length,
        honeypot: honeypot || undefined,
        device_id: getDeviceId(),
      });

      // 2. Upload each photo
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const uploadInfo = result.upload_urls[i];
        await uploadPhoto(uploadInfo.signed_url, photo.blob, 'image/jpeg');
      }

      // 3. Save locally
      saveLocalReport({
        id: result.report_id,
        created_at: new Date().toISOString(),
        status: 'pending_review',
        lat,
        lon,
        description: description.trim(),
      });

      setReportId(result.report_id);
      setStep('confirm');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('errors.generic');
      if (msg.includes('rate') || msg.includes('429')) {
        setError(t('errors.tooManyRequests'));
      } else if (msg.includes('outside') || msg.includes('service area')) {
        setError(t('errors.outsideArea'));
      } else if (msg.includes('upload') || msg.includes('Upload')) {
        setError(t('errors.uploadFailed'));
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetFlow() {
    revokePhotoPreviews(photos);
    setStep('map');
    setLat(null);
    setLon(null);
    setAddress('');
    setPhotos([]);
    setDescription('');
    setCategory(null);
    setHoneypot('');
    setError('');
    setReportId('');
  }

  // ── MAP STEP ──────────────────────────────────────────────────────────
  if (step === 'map') {
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <LanguageBar />
        <MapView
          onLocationSelect={handleLocationSelect}
          selectedLat={lat ?? undefined}
          selectedLon={lon ?? undefined}
        />

        {lat != null && lon != null && isInsideServiceArea(lat, lon) && (
          <div className="banner success">
            <span>
              {address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`}
            </span>
          </div>
        )}

        {!lat && (
          <div
            style={{
              position: 'fixed',
              bottom: 90,
              left: 16,
              right: 16,
              zIndex: 1000,
              textAlign: 'center',
              color: 'var(--c-text-secondary)',
              fontSize: 14,
            }}
          >
            {t('map.tapToPlace')}
          </div>
        )}

        <button
          className="fab"
          disabled={!canContinueFromMap()}
          onClick={() => setStep('photos')}
        >
          {t('map.continue')}
        </button>
      </div>
    );
  }

  // ── PHOTOS STEP ───────────────────────────────────────────────────────
  if (step === 'photos') {
    return (
      <div className="sheet">
        <div className="sheet-header">
          <h2>{t('photos.title')}</h2>
          <button className="btn-ghost" onClick={() => setStep('map')}>
            {t('photos.back')}
          </button>
        </div>

        <div className="sheet-body">
          <p
            style={{
              marginBottom: 16,
              fontSize: 14,
              color: 'var(--c-text-secondary)',
            }}
          >
            {t('photos.subtitle')}
          </p>
          <PhotoCapture photos={photos} onPhotosChange={setPhotos} />
        </div>

        <div className="sheet-footer">
          <button
            className="btn btn-secondary"
            onClick={() => setStep('map')}
          >
            {t('photos.back')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!canContinueFromPhotos()}
            onClick={() => setStep('details')}
          >
            {t('photos.continue')}
          </button>
        </div>
      </div>
    );
  }

  // ── DETAILS STEP ──────────────────────────────────────────────────────
  if (step === 'details') {
    return (
      <div className="sheet">
        <div className="sheet-header">
          <h2>{t('details.title')}</h2>
          <button className="btn-ghost" onClick={() => setStep('photos')}>
            {t('details.back')}
          </button>
        </div>

        <div className="sheet-body">
          <div className="form-group">
            <label className="form-label">{t('details.description')}</label>
            <textarea
              className="form-input form-textarea"
              placeholder={t('details.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div className="form-group">
            <label className="form-label">{t('details.category')}</label>
            <div className="category-picker">
              <button
                type="button"
                className={`category-card ${category === 'waste' ? 'selected' : ''}`}
                onClick={() => setCategory('waste')}
              >
                <div className="category-card-icon">&#128465;</div>
                <div className="category-card-text">
                  <h3>{t('details.categoryWaste')}</h3>
                  <p>{t('details.categoryWasteHelp')}</p>
                </div>
              </button>
              <button
                type="button"
                className={`category-card ${category === 'litter' ? 'selected' : ''}`}
                onClick={() => setCategory('litter')}
              >
                <div className="category-card-icon">&#129529;</div>
                <div className="category-card-text">
                  <h3>{t('details.categoryLitter')}</h3>
                  <p>{t('details.categoryLitterHelp')}</p>
                </div>
              </button>
            </div>
          </div>

          <div className="privacy-notice">
            <Trans
              i18nKey="details.privacy"
              components={{
                mail: <a href="mailto:info@gironaneta.cat" />,
                privacy: <a href="/privacy" target="_blank" rel="noopener noreferrer" />,
              }}
            />
          </div>

          {/* Honeypot — hidden from real users */}
          <div style={{ position: 'absolute', left: -9999, opacity: 0 }}>
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {error && (
            <div
              style={{
                background: 'var(--c-danger-light)',
                color: 'var(--c-danger)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 14,
                marginTop: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="sheet-footer">
          <button
            className="btn btn-secondary"
            onClick={() => setStep('photos')}
          >
            {t('details.back')}
          </button>
          <button
            className="btn btn-primary"
            disabled={submitting || !category}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <div className="spinner" />
                {t('details.submitting')}
              </>
            ) : (
              t('details.submit')
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── CONFIRMATION STEP ─────────────────────────────────────────────────
  return (
    <div className="confirm-screen">
      <div className="confirm-icon">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--c-success)"
          strokeWidth="2"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>

      <h1 style={{ fontSize: 24, marginBottom: 8 }}>{t('confirm.title')}</h1>
      <p
        style={{
          color: 'var(--c-text-secondary)',
          fontSize: 15,
          maxWidth: 300,
          lineHeight: 1.5,
        }}
      >
        {t('confirm.message')}
      </p>

      <div className="confirm-code">
        <span>{t('confirm.reportCode')}:</span>
        <strong>{reportId.slice(0, 8).toUpperCase()}</strong>
        <button
          className="btn-ghost"
          onClick={() => navigator.clipboard?.writeText(reportId)}
          style={{ padding: '4px 8px', fontSize: 12 }}
        >
          {t('confirm.copyCode')}
        </button>
      </div>

      <div
        className="status-badge pending_review"
        style={{ marginBottom: 32 }}
      >
        {t('confirm.status')}
      </div>

      <button className="btn btn-primary" onClick={resetFlow}>
        {t('confirm.newReport')}
      </button>
    </div>
  );
}
