import { supabase } from './supabase';
import type {
  CreateReportPayload,
  CreateReportResponse,
  ReverseGeocodeResponse,
} from '../types';

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Create a report via the create-report edge function.
 * Returns report_id and signed upload URLs for photos.
 */
export async function createReport(
  payload: CreateReportPayload
): Promise<CreateReportResponse> {
  const res = await fetch(`${FUNCTIONS_BASE}/create-report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Upload a compressed photo to a signed URL.
 */
export async function uploadPhoto(
  signedUrl: string,
  file: Blob,
  mimeType: string
): Promise<void> {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: file,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }
}

/**
 * Reverse geocode via edge function.
 */
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<string> {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/reverse-geocode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ lat, lon }),
    });

    if (!res.ok) return '';
    const data: ReverseGeocodeResponse = await res.json();
    return data.address_label || '';
  } catch {
    return '';
  }
}

// ============================================================================
// Admin API (authenticated)
// ============================================================================

export async function adminGetReports(
  status?: string
) {
  let query = supabase
    .from('reports')
    .select('*, report_media(*)')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function adminGetReport(id: string) {
  const { data, error } = await supabase
    .from('reports')
    .select('*, report_media(*)')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function adminUpdateReport(
  id: string,
  updates: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from('reports')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function adminDeleteReport(id: string) {
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) throw error;
}

export async function adminSendReport(reportId: string) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(`${FUNCTIONS_BASE}/submit-to-fcc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ report_id: reportId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Send failed: ${res.status}`);
  }

  return res.json();
}

export async function adminGetSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('report-media')
    .createSignedUrl(path, 300); // 5 min expiry

  if (error) throw error;
  return data.signedUrl;
}

export async function adminCheckAuth(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { data } = await supabase
    .from('admin_users')
    .select('email')
    .eq('email', session.user.email)
    .single();

  return !!data;
}
