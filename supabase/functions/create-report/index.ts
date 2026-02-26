// Supabase Edge Function: create-report
// Validates input, enforces geofence, rate-limits by IP, creates report,
// returns signed upload URLs for photos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GIRONA_LAT = 41.9794;
const GIRONA_LON = 2.8214;
const SERVICE_RADIUS_M = 5000;
const MAX_PHOTOS = 5;
const RATE_LIMIT_PER_HOUR = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  try {
    const body = await req.json();
    const {
      lat,
      lon,
      description,
      category,
      photo_count,
      honeypot,
      device_id,
    } = body;

    // ── Honeypot check ─────────────────────────────────────────────
    if (honeypot) {
      // Silently accept but discard (bot detected)
      return jsonOk({
        report_id: crypto.randomUUID(),
        upload_urls: [],
      });
    }

    // ── Validate input ─────────────────────────────────────────────
    if (typeof lat !== 'number' || lat < -90 || lat > 90) {
      return jsonError('Invalid latitude', 400);
    }
    if (typeof lon !== 'number' || lon < -180 || lon > 180) {
      return jsonError('Invalid longitude', 400);
    }
    if (typeof photo_count !== 'number' || photo_count < 1 || photo_count > MAX_PHOTOS) {
      return jsonError(`photo_count must be 1-${MAX_PHOTOS}`, 400);
    }
    if (category !== 'waste' && category !== 'litter') {
      return jsonError('category must be "waste" or "litter"', 400);
    }

    // ── Geofence ───────────────────────────────────────────────────
    const distance = haversineDistance(lat, lon, GIRONA_LAT, GIRONA_LON);
    const insideServiceArea = distance <= SERVICE_RADIUS_M;

    if (!insideServiceArea) {
      return jsonError('Location is outside the Girona service area', 400);
    }

    // ── Rate limiting by IP ────────────────────────────────────────
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';

    // Hash IP for privacy
    const ipHash = await hashString(clientIp);

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Count recent reports from this IP
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', oneHourAgo);

    if (count != null && count >= RATE_LIMIT_PER_HOUR) {
      return jsonError('Too many requests. Please try again later.', 429);
    }

    // ── Insert report ──────────────────────────────────────────────
    const { data: report, error: insertError } = await supabase
      .from('reports')
      .insert({
        lat,
        lon,
        distance_to_girona_m: Math.round(distance),
        inside_service_area: insideServiceArea,
        description: description || null,
        category,
        ip_hash: ipHash,
        user_device_id: device_id || null,
        status: 'pending_review',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return jsonError('Failed to create report', 500);
    }

    // ── Generate signed upload URLs ─────────────────────────────────
    const uploadUrls = [];
    for (let i = 0; i < photo_count; i++) {
      const path = `${report.id}/${i}.jpg`;

      const { data: signedData, error: signError } = await supabase.storage
        .from('report-media')
        .createSignedUploadUrl(path);

      if (signError) {
        console.error('Signed URL error:', signError);
        return jsonError('Failed to generate upload URL', 500);
      }

      // Insert media record
      await supabase.from('report_media').insert({
        report_id: report.id,
        storage_path: path,
        mime_type: 'image/jpeg',
        compressed_bytes: 0, // Updated after upload
        width: 0,
        height: 0,
      });

      uploadUrls.push({
        path,
        signed_url: signedData.signedUrl,
        token: signedData.token,
      });
    }

    return jsonOk({
      report_id: report.id,
      upload_urls: uploadUrls,
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return jsonError('Internal server error', 500);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

async function hashString(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
