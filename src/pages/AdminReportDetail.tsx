import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import {
  adminGetReport,
  adminUpdateReport,
  adminDeleteReport,
  adminSendReport,
  adminGetSignedUrl,
} from '../lib/api';
import type { ReportWithMedia } from '../types';

export default function AdminReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [report, setReport] = useState<ReportWithMedia | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Edit state
  const [editDescription, setEditDescription] = useState('');
  const [editOverride, setEditOverride] = useState(false);

  // Auth guard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/admin', { replace: true });
    });
  }, [navigate]);

  const loadReport = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await adminGetReport(id);
      setReport(data as ReportWithMedia);
      setEditDescription(data.description || '');
      setEditOverride(data.admin_override || false);

      // Load signed URLs for images
      if (data.report_media) {
        const urls: Record<string, string> = {};
        for (const media of data.report_media) {
          try {
            urls[media.id] = await adminGetSignedUrl(media.storage_path);
          } catch {
            // ignore individual failures
          }
        }
        setImageUrls(urls);
      }
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function handleSave() {
    if (!id) return;
    setActionLoading('save');
    try {
      await adminUpdateReport(id, {
        description: editDescription,
        admin_override: editOverride,
      });
      setEditing(false);
      await loadReport();
      setSuccess(t('admin.save'));
    } catch {
      setError(t('errors.generic'));
    } finally {
      setActionLoading('');
    }
  }

  async function handleApprove() {
    if (!id || !confirm(t('admin.confirmApprove'))) return;
    setActionLoading('approve');
    setError('');
    setSuccess('');
    try {
      await adminSendReport(id);
      setSuccess(t('admin.sendSuccess'));
      await loadReport();
    } catch (err) {
      // Revert status to pending_review so admin can retry
      try {
        await adminUpdateReport(id, { status: 'pending_review' });
      } catch {
        // ignore revert failure
      }
      setError(
        err instanceof Error ? err.message : t('admin.sendError')
      );
      await loadReport();
    } finally {
      setActionLoading('');
    }
  }

  async function handleReject() {
    if (!id || !confirm(t('admin.confirmReject'))) return;
    setActionLoading('reject');
    try {
      await adminUpdateReport(id, { status: 'rejected' });
      await loadReport();
    } catch {
      setError(t('errors.generic'));
    } finally {
      setActionLoading('');
    }
  }

  async function handleDelete() {
    if (!id || !confirm(t('admin.confirmDelete'))) return;
    setActionLoading('delete');
    try {
      await adminDeleteReport(id);
      navigate('/admin/dashboard', { replace: true });
    } catch {
      setError(t('errors.generic'));
    } finally {
      setActionLoading('');
    }
  }

  if (loading) {
    return (
      <div className="admin-layout">
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div className="spinner dark" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="admin-layout">
        <div style={{ textAlign: 'center', padding: 60 }}>
          Report not found.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <div className="admin-header">
        <button
          className="btn-ghost"
          onClick={() => navigate('/admin/dashboard')}
          style={{ color: '#fff' }}
        >
          ← {t('admin.back')}
        </button>
        <h1>{t('admin.reportDetail')}</h1>
        <div style={{ width: 60 }} />
      </div>

      <div className="admin-detail">
        {/* Status */}
        <div className="admin-detail-section">
          <h3>{t('admin.status')}</h3>
          <span className={`status-badge ${report.status}`}>
            {report.status.replace('_', ' ')}
          </span>
        </div>

        {/* Location */}
        <div className="admin-detail-section">
          <h3>{t('admin.location')}</h3>
          <p>{report.address_label || '—'}</p>
          <p style={{ fontSize: 13, color: 'var(--c-text-secondary)', fontFamily: 'monospace' }}>
            {report.lat.toFixed(6)}, {report.lon.toFixed(6)}
          </p>
          <p style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
            {t('admin.distance')}: {report.distance_to_girona_m}m
            {!report.inside_service_area && ' (outside)'}
          </p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lon}#map=18/${report.lat}/${report.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13 }}
          >
            OpenStreetMap ↗
          </a>
        </div>

        {/* Description */}
        <div className="admin-detail-section">
          <h3>{t('admin.description')}</h3>
          {editing ? (
            <textarea
              className="form-input form-textarea"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
            />
          ) : (
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {report.description || '—'}
            </p>
          )}
        </div>

        {/* Hazardous */}
        <div className="admin-detail-section">
          <h3>{t('admin.hazardous')}</h3>
          <p>{report.potentially_hazardous ? '⚠ Yes' : 'No'}</p>
        </div>

        {/* Admin override */}
        {editing && (
          <div className="admin-detail-section">
            <div className="toggle-row">
              <button
                className={`toggle-track ${editOverride ? 'on' : ''}`}
                onClick={() => setEditOverride(!editOverride)}
                role="switch"
                aria-checked={editOverride}
              />
              <div>
                <div className="toggle-label">{t('admin.override')}</div>
              </div>
            </div>
          </div>
        )}

        {/* Photos */}
        <div className="admin-detail-section">
          <h3>{t('admin.photos')}</h3>
          <div className="photo-grid">
            {report.report_media?.map((media) => (
              <div key={media.id} className="photo-card">
                {imageUrls[media.id] ? (
                  <img src={imageUrls[media.id]} alt="" />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div className="spinner dark" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Metadata */}
        <div className="admin-detail-section">
          <h3>{t('admin.date')}</h3>
          <p>{new Date(report.created_at).toLocaleString()}</p>
        </div>

        {report.sent_at && (
          <div className="admin-detail-section">
            <h3>{t('admin.sentAt')}</h3>
            <p>{new Date(report.sent_at).toLocaleString()}</p>
          </div>
        )}

        {report.resend_message_id && (
          <div className="admin-detail-section">
            <h3>{t('admin.resendId')}</h3>
            <p style={{ fontFamily: 'monospace', fontSize: 13 }}>
              {report.resend_message_id}
            </p>
          </div>
        )}

        {report.last_error && (
          <div className="admin-detail-section">
            <h3>{t('admin.lastError')}</h3>
            <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>
              {report.last_error}
            </p>
          </div>
        )}

        {report.user_device_id && (
          <div className="admin-detail-section">
            <h3>{t('admin.deviceId')}</h3>
            <p style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {report.user_device_id}
            </p>
          </div>
        )}

        {/* Feedback messages */}
        {error && (
          <div
            style={{
              background: 'var(--c-danger-light)',
              color: 'var(--c-danger)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        {success && (
          <div
            style={{
              background: 'var(--c-success-bg)',
              color: 'var(--c-success)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            {success}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="admin-actions">
        {editing ? (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setEditing(false)}
            >
              {t('admin.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={actionLoading === 'save'}
            >
              {actionLoading === 'save' ? (
                <div className="spinner" />
              ) : (
                t('admin.save')
              )}
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setEditing(true)}
            >
              {t('admin.edit')}
            </button>

            {(report.status === 'pending_review' || report.status === 'approved_sending') && (
              <button
                className="btn btn-primary btn-small"
                onClick={handleApprove}
                disabled={!!actionLoading}
              >
                {actionLoading === 'approve' ? (
                  <div className="spinner" />
                ) : (
                  report.status === 'approved_sending'
                    ? t('admin.retry')
                    : t('admin.approve')
                )}
              </button>
            )}

            {(report.status === 'pending_review' || report.status === 'approved_sending') && (
              <button
                className="btn btn-danger btn-small"
                onClick={handleReject}
                disabled={!!actionLoading}
              >
                {t('admin.reject')}
              </button>
            )}

            <button
              className="btn btn-danger btn-small"
              onClick={handleDelete}
              disabled={!!actionLoading}
              style={{ opacity: 0.7 }}
            >
              {t('admin.delete')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
