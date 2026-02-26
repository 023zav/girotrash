/**
 * Cloudflare Email Worker — Reply Tracker for Girona Neta
 *
 * This worker intercepts incoming emails to info+{report_id}@gironaneta.cat,
 * extracts the report_id from the plus-address, parses the reply body,
 * and forwards it to the Supabase receive-reply edge function.
 *
 * Setup:
 *   1. Create a Cloudflare Worker with this code.
 *   2. Add environment variables (Settings → Variables):
 *      - SUPABASE_URL: your Supabase project URL (e.g. https://xyz.supabase.co)
 *      - REPLY_WEBHOOK_SECRET: a shared secret (same value in Supabase edge function env)
 *   3. In Cloudflare Email Routing → Routing Rules, add a catch-all or
 *      pattern rule for info+*@gironaneta.cat → Send to Worker → this worker.
 *   4. Keep existing forwarding rule for plain info@gironaneta.cat → personal email.
 */

export default {
  async email(message, env, ctx) {
    // ── Extract report_id from the To address ──────────────────────
    // Incoming "To" may look like: info+abc123-def456@gironaneta.cat
    const toAddress = message.to; // e.g. "info+abc123@gironaneta.cat"
    const plusMatch = toAddress.match(/^info\+([a-f0-9-]+)@gironaneta\.cat$/i);

    if (!plusMatch) {
      // Not a plus-addressed report reply — let it fall through
      // (Cloudflare will apply the next routing rule, e.g. forward to personal email)
      message.setReject("Address not recognized");
      return;
    }

    const reportId = plusMatch[1];

    // ── Read email body ────────────────────────────────────────────
    let rawBody = "";
    try {
      // message.raw is a ReadableStream of the full RFC 822 message
      const rawEmail = await new Response(message.raw).text();
      rawBody = extractPlainText(rawEmail);
    } catch (err) {
      console.error("Failed to read email body:", err);
      rawBody = "(Could not parse email body)";
    }

    // Extract sender
    const replyFrom = message.from || "unknown";

    // ── Forward to Supabase receive-reply edge function ────────────
    const webhookUrl = `${env.SUPABASE_URL}/functions/v1/receive-reply`;

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": env.REPLY_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          report_id: reportId,
          reply_text: rawBody.substring(0, 5000), // cap at 5000 chars
          reply_from: replyFrom,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.error(`receive-reply returned ${res.status}: ${errBody}`);
      } else {
        console.log(`Reply stored for report ${reportId} from ${replyFrom}`);
      }
    } catch (err) {
      console.error("Failed to call receive-reply:", err);
    }

    // Don't reject — the email has been processed.
    // Optionally forward to personal email too:
    // await message.forward("your@personal.email");
  },
};

/**
 * Extract plain text body from a raw RFC 822 email.
 * Handles simple text/plain, multipart, and quoted-printable encoding.
 */
function extractPlainText(raw) {
  // Try to find a text/plain part in multipart messages
  const boundaryMatch = raw.match(/boundary="?([^\s";\r\n]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split("--" + boundary);

    for (const part of parts) {
      // Look for text/plain part
      if (/content-type:\s*text\/plain/i.test(part)) {
        return decodeEmailPart(part);
      }
    }

    // Fallback: try text/html and strip tags
    for (const part of parts) {
      if (/content-type:\s*text\/html/i.test(part)) {
        const html = decodeEmailPart(part);
        return stripHtml(html);
      }
    }
  }

  // Non-multipart: extract body after headers
  const headerBodySplit = raw.indexOf("\r\n\r\n");
  if (headerBodySplit === -1) {
    const altSplit = raw.indexOf("\n\n");
    if (altSplit === -1) return raw.substring(0, 2000);
    return decodeBody(raw.substring(altSplit + 2), raw);
  }

  return decodeBody(raw.substring(headerBodySplit + 4), raw);
}

/**
 * Extract and decode body from a MIME part.
 */
function decodeEmailPart(part) {
  // Find where headers end and body begins
  const headerEnd = part.indexOf("\r\n\r\n");
  const altHeaderEnd = part.indexOf("\n\n");
  const splitPos =
    headerEnd !== -1 ? headerEnd + 4 : altHeaderEnd !== -1 ? altHeaderEnd + 2 : 0;

  const headers = part.substring(0, splitPos);
  let body = part.substring(splitPos);

  // Decode quoted-printable if needed
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
    body = decodeQuotedPrintable(body);
  }

  // Decode base64 if needed
  if (/content-transfer-encoding:\s*base64/i.test(headers)) {
    try {
      body = atob(body.replace(/\s/g, ""));
    } catch {
      // keep as-is
    }
  }

  return body.trim();
}

function decodeBody(body, fullRaw) {
  if (/content-transfer-encoding:\s*quoted-printable/i.test(fullRaw)) {
    return decodeQuotedPrintable(body).trim();
  }
  if (/content-transfer-encoding:\s*base64/i.test(fullRaw)) {
    try {
      return atob(body.replace(/\s/g, "")).trim();
    } catch {
      return body.trim();
    }
  }
  return body.trim();
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, "") // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
