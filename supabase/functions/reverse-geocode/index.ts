// Supabase Edge Function: reverse-geocode
// Proxies Nominatim reverse geocoding with caching and throttling.
// Complies with Nominatim usage policy:
//   - Custom User-Agent set via NOMINATIM_USER_AGENT env var
//   - Max 1 request/second (global best-effort via cache + timestamp)
//   - Cached by lat/lon rounded to 5 decimals (~1.1m precision)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CACHE_DECIMALS = 5;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

// Simple global throttle (best-effort per instance)
let lastNominatimCall = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResp({ error: 'Method not allowed' }, 405);
  }

  try {
    const { lat, lon } = await req.json();

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return jsonResp({ error: 'Invalid lat/lon' }, 400);
    }

    const roundedLat = roundTo(lat, CACHE_DECIMALS);
    const roundedLon = roundTo(lon, CACHE_DECIMALS);

    // Supabase client (service role for cache read/write)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Check cache ─────────────────────────────────────────────────
    const { data: cached } = await supabase
      .from('geocode_cache')
      .select('address_label')
      .eq('rounded_lat', roundedLat)
      .eq('rounded_lon', roundedLon)
      .single();

    if (cached) {
      return jsonResp({ address_label: cached.address_label });
    }

    // ── Throttle: wait if last call was < 1s ago ────────────────────
    const now = Date.now();
    const elapsed = now - lastNominatimCall;
    if (elapsed < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - elapsed));
    }
    lastNominatimCall = Date.now();

    // ── Call Nominatim ──────────────────────────────────────────────
    const userAgent =
      Deno.env.get('NOMINATIM_USER_AGENT') ||
      'GiroTrash/1.0 (contact@girotrash.app)';

    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('format', 'json');
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lon', lon.toString());
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');

    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'ca',
      },
    });

    if (!resp.ok) {
      console.error('Nominatim error:', resp.status);
      return jsonResp({ address_label: '' });
    }

    const data = await resp.json();
    const addressLabel = data.display_name
      ? data.display_name.split(',').slice(0, 3).join(', ').trim()
      : '';

    // ── Cache result ────────────────────────────────────────────────
    if (addressLabel) {
      await supabase.from('geocode_cache').upsert({
        rounded_lat: roundedLat,
        rounded_lon: roundedLon,
        address_label: addressLabel,
        updated_at: new Date().toISOString(),
      });
    }

    return jsonResp({ address_label: addressLabel });
  } catch (err) {
    console.error('Reverse geocode error:', err);
    return jsonResp({ address_label: '' });
  }
});

function roundTo(num: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
