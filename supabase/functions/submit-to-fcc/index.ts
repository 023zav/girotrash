// Supabase Edge Function: submit-to-fcc
// Admin-only. Fetches report + media from DB/Storage, submits incident
// to FCC Medi Ambient's API (appgirona.fccma.com). Updates report status.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FCC_API_URL = 'https://appgirona.fccma.com/apprest/app-tarjeta-submit';

// Map our categories to FCC's type/option codes
const CATEGORY_MAP = {
  waste: { type: '008', option: '202', ambit: '000' }, // Residus a la via pública
  litter: { type: '009', option: '211', ambit: '000' }, // Brutícia al carrer
} as const;

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
    return jsonError('Method not allowed', 405);
  }

  try {
    // ── Authenticate admin ───────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonError('Unauthorized: no auth header', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Extract JWT token and verify user
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return jsonError(`Unauthorized: ${authError?.message || 'invalid token'}`, 401);
    }

    // Check against DB allowlist
    const { data: adminEntry } = await adminClient
      .from('admin_users')
      .select('email')
      .eq('email', user.email)
      .single();

    // Also check env var allowlist as fallback
    const envAllowlist = Deno.env.get('ADMIN_EMAIL_ALLOWLIST') || '';
    const allowedEmails = envAllowlist.split(',').map((e) => e.trim().toLowerCase());
    const isAdmin = !!adminEntry || allowedEmails.includes(user.email!.toLowerCase());

    if (!isAdmin) {
      return jsonError('Forbidden: not an admin', 403);
    }

    // ── Get report ────────────────────────────────────────────────────
    const { report_id } = await req.json();
    if (!report_id) {
      return jsonError('report_id required', 400);
    }

    const { data: report, error: reportError } = await adminClient
      .from('reports')
      .select('*, report_media(*)')
      .eq('id', report_id)
      .single();

    if (reportError || !report) {
      return jsonError('Report not found', 404);
    }

    // Update status to approved_sending
    await adminClient
      .from('reports')
      .update({ status: 'approved_sending' })
      .eq('id', report_id);

    // ── Download first photo from Storage ──────────────────────────
    let photoBlob: Blob | null = null;

    if (report.report_media && report.report_media.length > 0) {
      const firstMedia = report.report_media[0];
      const { data: fileData, error: fileError } = await adminClient.storage
        .from('report-media')
        .download(firstMedia.storage_path);

      if (fileError || !fileData) {
        console.error(`Failed to download ${firstMedia.storage_path}:`, fileError);
      } else {
        photoBlob = fileData;
      }
    }

    if (!photoBlob) {
      // Revert status if no photo available
      await adminClient
        .from('reports')
        .update({
          status: 'pending_review',
          last_error: 'No photo available for FCC submission',
        })
        .eq('id', report_id);

      return jsonError('No photo available for submission', 400);
    }

    // ── Build FCC submission ──────────────────────────────────────
    const categoryConfig = CATEGORY_MAP[report.category as keyof typeof CATEGORY_MAP];
    if (!categoryConfig) {
      await adminClient
        .from('reports')
        .update({
          status: 'pending_review',
          last_error: `Invalid category: ${report.category}`,
        })
        .eq('id', report_id);

      return jsonError(`Invalid category: ${report.category}`, 400);
    }

    // Build observations text in Catalan
    const categoryLabel = report.category === 'waste'
      ? 'Residus a la via pública'
      : 'Brutícia al carrer';

    let observations = `[${categoryLabel}]`;
    if (report.description) {
      observations += `\n${report.description}`;
    }
    observations += `\n\nRef: ${report.id}`;

    const address = report.address_label || `${report.lat.toFixed(6)}, ${report.lon.toFixed(6)}`;

    const formData = new FormData();
    formData.append('phone', '-');
    formData.append('email', `info+${report.id}@gironaneta.cat`);
    formData.append('contact', 'Girona Neta');
    formData.append('address', address);
    formData.append('observations', observations);
    formData.append('file', photoBlob, 'foto_1.jpg');
    formData.append('filename', 'foto_1.jpg');
    formData.append('language', 'ca');
    formData.append('lat', report.lat.toString());
    formData.append('lng', report.lon.toString());
    formData.append('type', categoryConfig.type);
    formData.append('ambit', categoryConfig.ambit);
    formData.append('option', categoryConfig.option);
    formData.append('g-recaptcha-response', '-');

    // ── Submit to FCC ─────────────────────────────────────────────
    const fccResp = await fetch(FCC_API_URL, {
      method: 'POST',
      body: formData,
    });

    const fccText = await fccResp.text();
    let fccResult: Record<string, string>;

    try {
      fccResult = JSON.parse(fccText);
    } catch {
      console.error('FCC non-JSON response:', fccText);

      await adminClient
        .from('reports')
        .update({
          status: 'pending_review',
          last_error: `FCC error (${fccResp.status}): ${fccText.substring(0, 200)}`,
        })
        .eq('id', report_id);

      return jsonError(`FCC submission failed: ${fccText.substring(0, 200)}`, 502);
    }

    // FCC returns {resultado: "1", mensaje: ""} on success
    // or {altainc: "XXXXX"} with incident ID
    // or {id: "E000", name: "error message"} on error
    if (fccResult.id === 'E000') {
      console.error('FCC error:', fccResult);

      await adminClient
        .from('reports')
        .update({
          status: 'pending_review',
          last_error: `FCC error: ${fccResult.name || JSON.stringify(fccResult)}`,
        })
        .eq('id', report_id);

      return jsonError(`FCC submission failed: ${fccResult.name}`, 502);
    }

    // ── Update report on success ──────────────────────────────────
    const fccIncidentId = fccResult.altainc || fccResult.resultado || null;

    await adminClient
      .from('reports')
      .update({
        status: 'sent',
        fcc_incident_id: fccIncidentId,
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', report_id);

    return jsonOk({
      success: true,
      fcc_incident_id: fccIncidentId,
    });
  } catch (err) {
    console.error('Submit to FCC error:', err);
    return jsonError('Internal server error', 500);
  }
});

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
