const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Sends the verification email via Resend if RESEND_API_KEY is set.
 *
 * If it's not set (e.g. local dev, or before you've signed up for Resend),
 * this logs the verification link to the console instead of failing —
 * that's what makes the whole verification flow testable end-to-end
 * without any email provider configured yet. See README "Setting up real
 * email" for how to wire up a real key.
 */
export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || "Invoice Chaser <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(`[email:dev-mode] Would send verification email to ${to}`);
    console.log(`[email:dev-mode] Verification link: ${verifyUrl}`);
    return { sent: false, mode: "dev-log" as const };
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [to],
      subject: "Verify your Invoice Chaser account",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #16243A;">Welcome to Invoice Chaser, ${escapeHtml(name)}</h2>
          <p>Click the button below to verify your email and activate your account.</p>
          <p style="margin: 28px 0;">
            <a href="${verifyUrl}" style="background:#3FB78A; color:#0B1524; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700;">
              Verify email
            </a>
          </p>
          <p style="color:#8B9AAE; font-size:13px;">If the button doesn't work, copy this link into your browser:<br>${verifyUrl}</p>
          <p style="color:#8B9AAE; font-size:13px;">This link expires in 24 hours.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }

  return { sent: true, mode: "resend" as const };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
