const RESEND_API_KEY = () => process.env.RESEND_API_KEY
const FROM_EMAIL = () => process.env.RESEND_FROM_EMAIL || 'noreply@meridianmarkets.app'

export function isMailerConfigured() {
  return !!RESEND_API_KEY()
}

export async function sendPasswordResetEmail(toEmail, resetCode) {
  const apiKey = RESEND_API_KEY()
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL(),
      to: toEmail,
      subject: 'Your password reset code',
      html: `<p>Your password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${resetCode}</p><p>This code expires in 15 minutes.</p>`,
    }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `Resend API error: ${response.status}`)
  }

  return response.json()
}

export async function sendAlertEmail(toEmail, alertType, symbol, message, details = {}) {
  const apiKey = RESEND_API_KEY()
  if (!apiKey) return

  const subject = `[Meridian Markets] ${alertType}: ${symbol || message}`
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
    <h2 style="color:#2563eb;margin-bottom:8px">Meridian Markets Alert</h2>
    <p style="font-size:14px;line-height:1.6;color:#374151">${message}</p>
    ${details.link ? `<p><a href="${details.link}" style="display:inline-block;padding:8px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:13px">View dashboard</a></p>` : ''}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
    <p style="font-size:11px;color:#9ca3af">You received this because email alerts are enabled for your account. <a href="${details.link || 'https://meridianmarkets.app'}">Change settings</a>.</p>
  </div>`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL(),
      to: toEmail,
      subject,
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `Resend API error: ${response.status}`)
  }

  return response.json()
}
