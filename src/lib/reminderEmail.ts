export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
}

export type SendResult = { sent: true } | { sent: false };

/** Send through Resend. Without a key, log only in development and fail closed in production. */
export async function sendEmail(msg: OutgoingEmail): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not configured");
    console.log(`[email:dev-mode] Would send "${msg.subject}" to ${msg.to}`);
    return { sent: false };
  }

  const configuredFrom = process.env.EMAIL_FROM || "Invoice Chaser <onboarding@resend.dev>";
  const match = configuredFrom.match(/<([^>]+)>/);
  const address = (match ? match[1] : configuredFrom).trim();
  const name = (msg.fromName || "Invoice Chaser").replace(/[<>"\r\n]/g, "").slice(0, 80);
  const response = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${name} <${address}>`,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend API error (${response.status}): ${detail.slice(0, 300)}`);
  }
  return { sent: true };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] as string));
}
