// Supabase Edge Function: receive-reply
// Called by Cloudflare Email Worker when a reply arrives at info+{report_id}@gironaneta.cat.
// Updates the report status to 'replied' and stores the reply text.
// Secured by a shared secret (REPLY_WEBHOOK_SECRET env var).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
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
    // ── Verify webhook secret ─────────────────────────────────────
    const webhookSecret = Deno.env.get('REPLY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('REPLY_WEBHOOK_SECRET not configured');
      return jsonError('Webhook not configured', 500);
    }

    const providedSecret = req.headers.get('x-webhook-secret');
    if (providedSecret !== webhookSecret) {
      return jsonError('Unauthorized', 401);
    }

    // ── Parse payload ─────────────────────────────────────────────
    const { report_id, reply_text, reply_from } = await req.json();

    if (!report_id) {
      return jsonError('report_id required', 400);
    }
    if (!reply_text) {
      return jsonError('reply_text required', 400);
    }

    // ── Update report ─────────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify report exists and is in a sent state
    const { data: report, error: fetchError } = await supabase
      .from('reports')
      .select('id, status')
      .eq('id', report_id)
      .single();

    if (fetchError || !report) {
      console.error('Report not found:', report_id);
      return jsonError('Report not found', 404);
    }

    // Only update if report has been sent (don't overwrite other states)
    if (report.status !== 'sent' && report.status !== 'replied') {
      console.warn(`Report ${report_id} in unexpected status: ${report.status}`);
      // Still store the reply but don't change status
    }

    const updates: Record<string, unknown> = {
      reply_text: reply_text.substring(0, 5000), // Cap at 5000 chars
      reply_from: (reply_from || 'unknown').substring(0, 200),
      replied_at: new Date().toISOString(),
    };

    // Only move to 'replied' if currently 'sent' or already 'replied'
    if (report.status === 'sent' || report.status === 'replied') {
      updates.status = 'replied';
    }

    const { error: updateError } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', report_id);

    if (updateError) {
      console.error('Update error:', updateError);
      return jsonError('Failed to update report', 500);
    }

    console.log(`Reply stored for report ${report_id} from ${reply_from}`);

    return jsonOk({ success: true, report_id });
  } catch (err) {
    console.error('Receive reply error:', err);
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
