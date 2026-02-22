// Supabase Edge Function: send-report-email
// Admin-only. Fetches report + media from DB/Storage, sends email via Resend
// with photos as true attachments. Updates report status.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RECIPIENT_EMAIL = 'residusinetejagirona@ajgirona.cat';
const RESEND_API_URL = 'https://api.resend.com/emails';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Email templates in Catalan (always)
const EMAIL_TEMPLATES = {
  ca: {
    subject: (hazardous: boolean) =>
      hazardous
        ? '⚠ Report d\'abocador il·legal (materials perillosos) — Girona Neta'
        : 'Report d\'abocador il·legal — Girona Neta',
    body: (report: ReportData) => `Bon dia,

Us escrivim per comunicar-vos la detecció d'un abocador il·legal dins del terme municipal de Girona.

📍 UBICACIÓ
${report.address_label ? `Adreça aproximada: ${report.address_label}` : ''}
Coordenades: ${report.lat.toFixed(6)}, ${report.lon.toFixed(6)}
Distància al centre: ${report.distance_to_girona_m}m
Veure al mapa: https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lon}#map=18/${report.lat}/${report.lon}

📝 DESCRIPCIÓ
${report.description || '(Sense descripció)'}

${report.potentially_hazardous ? '⚠ ATENCIÓ: El reportant ha indicat que podria contenir materials perillosos (amiant, productes químics, etc.).\n' : ''}
📸 FOTOS
S'adjunten ${report.photo_count} foto${report.photo_count > 1 ? 's' : ''} de l'abocador.

---
Aquest report ha estat enviat des de l'aplicació Girona Neta (gironaneta.cat).
Codi del report: ${report.id}
Data del report: ${new Date(report.created_at).toLocaleString('ca-ES', { timeZone: 'Europe/Madrid' })}

Gràcies per la vostra atenció.
Girona Neta — gironaneta.cat`,
  },
};

interface ReportData {
  id: string;
  created_at: string;
  lat: number;
  lon: number;
  distance_to_girona_m: number;
  address_label: string | null;
  description: string | null;
  potentially_hazardous: boolean;
  email_lang: string;
  photo_count: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    return jsonError('RESEND_API_KEY not configured', 500);
  }

  try {
    // ── Authenticate admin ───────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonError('Unauthorized', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Verify JWT with anon client
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonError('Unauthorized', 401);
    }

    // Check admin allowlist
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

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

    // ── Fetch images from Storage ────────────────────────────────────
    const attachments: { filename: string; content: string }[] = [];

    for (let i = 0; i < report.report_media.length; i++) {
      const media = report.report_media[i];
      const { data: fileData, error: fileError } = await adminClient.storage
        .from('report-media')
        .download(media.storage_path);

      if (fileError || !fileData) {
        console.error(`Failed to download ${media.storage_path}:`, fileError);
        continue;
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer))
      );

      attachments.push({
        filename: `abocador_foto_${i + 1}.jpg`,
        content: base64,
      });
    }

    // ── Build email ─────────────────────────────────────────────────
    const tmpl = EMAIL_TEMPLATES.ca;
    const reportData: ReportData = {
      id: report.id,
      created_at: report.created_at,
      lat: report.lat,
      lon: report.lon,
      distance_to_girona_m: report.distance_to_girona_m,
      address_label: report.address_label,
      description: report.description,
      potentially_hazardous: report.potentially_hazardous,
      email_lang: report.email_lang,
      photo_count: report.report_media.length,
    };

    const emailSubject = tmpl.subject(report.potentially_hazardous);
    const emailBody = tmpl.body(reportData);

    // ── Send via Resend ─────────────────────────────────────────────
    // Resend requires a verified domain for the "from" address.
    // Use a placeholder; replace with your verified domain.
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'noreply@gironaneta.cat';

    const resendPayload: Record<string, unknown> = {
      from: `Girona Neta <${fromEmail}>`,
      to: [RECIPIENT_EMAIL],
      subject: emailSubject,
      text: emailBody,
    };

    if (attachments.length > 0) {
      resendPayload.attachments = attachments;
    }

    const resendResp = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    const resendResult = await resendResp.json();

    if (!resendResp.ok) {
      console.error('Resend error:', resendResult);

      // Revert status and store error
      await adminClient
        .from('reports')
        .update({
          status: 'pending_review',
          last_error: JSON.stringify(resendResult),
        })
        .eq('id', report_id);

      return jsonError(
        `Email send failed: ${resendResult.message || 'unknown error'}`,
        502
      );
    }

    // ── Update report ───────────────────────────────────────────────
    await adminClient
      .from('reports')
      .update({
        status: 'sent',
        resend_message_id: resendResult.id || null,
        sent_at: new Date().toISOString(),
        email_subject: emailSubject,
        last_error: null,
      })
      .eq('id', report_id);

    return jsonOk({
      success: true,
      resend_message_id: resendResult.id,
    });
  } catch (err) {
    console.error('Send email error:', err);
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
