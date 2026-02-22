import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { adminGetReports } from '../lib/api';
import LanguageBar from '../components/LanguageBar';
import type { ReportWithMedia, ReportStatus } from '../types';

const tabs: { key: string; statuses: ReportStatus[] | null }[] = [
  { key: 'pending', statuses: ['pending_review'] },
  { key: 'sent', statuses: ['approved_sending', 'sent', 'replied'] },
  { key: 'rejected', statuses: ['rejected'] },
  { key: 'all', statuses: null },
];

export default function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pending');
  const [reports, setReports] = useState<ReportWithMedia[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth guard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/admin', { replace: true });
    });
  }, [navigate]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const tab = tabs.find((tb) => tb.key === activeTab);
      let data: ReportWithMedia[];
      if (tab?.statuses) {
        // Fetch for each status and merge
        const results = await Promise.all(
          tab.statuses.map((s) => adminGetReports(s))
        );
        data = results.flat() as ReportWithMedia[];
        data.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );
      } else {
        data = (await adminGetReports()) as ReportWithMedia[];
      }
      setReports(data);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/admin', { replace: true });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="admin-layout">
      <LanguageBar />
      <div className="admin-header">
        <h1>{t('admin.dashboard')}</h1>
        <button className="btn-ghost" onClick={handleLogout} style={{ color: '#fff' }}>
          {t('admin.logout')}
        </button>
      </div>

      <div className="admin-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`admin-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {t(`admin.${tab.key}`)}
          </button>
        ))}
      </div>

      <div className="admin-list">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner dark" style={{ margin: '0 auto' }} />
          </div>
        ) : reports.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: 'var(--c-text-secondary)',
            }}
          >
            {t('admin.noReports')}
          </div>
        ) : (
          reports.map((report) => (
            <div
              key={report.id}
              className="admin-card"
              onClick={() => navigate(`/admin/report/${report.id}`)}
            >
              <div className="admin-card-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {report.address_label ||
                      `${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}`}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--c-text-secondary)',
                      marginTop: 4,
                    }}
                  >
                    {formatDate(report.created_at)} &middot;{' '}
                    {report.report_media?.length || 0} {t('admin.photos').toLowerCase()} &middot;{' '}
                    {report.distance_to_girona_m}m
                  </div>
                </div>
                <span className={`status-badge ${report.status}`}>
                  {t(`admin.${statusToKey(report.status)}`)}
                </span>
              </div>
              {report.description && (
                <p
                  style={{
                    fontSize: 13,
                    color: 'var(--c-text-secondary)',
                    marginTop: 8,
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {report.description}
                </p>
              )}
              {report.potentially_hazardous && (
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 6,
                    fontSize: 12,
                    color: 'var(--c-danger)',
                    fontWeight: 600,
                  }}
                >
                  ⚠ {t('admin.hazardous')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function statusToKey(status: ReportStatus): string {
  switch (status) {
    case 'pending_review':
      return 'pending';
    case 'approved_sending':
    case 'sent':
    case 'replied':
      return 'sent';
    case 'rejected':
      return 'rejected';
    case 'deleted':
      return 'delete';
    default:
      return 'pending';
  }
}
