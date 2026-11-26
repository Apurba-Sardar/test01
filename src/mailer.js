import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export const mailEnabled = () => !!(transport && config.smtp.to.length);

// Live status of the alert-email setup, shown on the dashboard.
export const mailStatus = { verified: null, verifyError: null, verifiedAt: null };
let onSent = () => {};
/** Register a callback that receives every send attempt: { t, subject, ok, error }. */
export const onMailAttempt = (fn) => (onSent = fn);

/** Log in to the SMTP server without sending anything (checks host, port and password). */
export async function verifyMail() {
  if (!transport) {
    Object.assign(mailStatus, { verified: null, verifyError: 'SMTP is not configured', verifiedAt: Date.now() });
    return mailStatus;
  }
  try {
    await transport.verify();
    Object.assign(mailStatus, { verified: true, verifyError: null, verifiedAt: Date.now() });
  } catch (err) {
    Object.assign(mailStatus, { verified: false, verifyError: err.message, verifiedAt: Date.now() });
    console.error(`[mail] SMTP login check failed: ${err.message}`);
  }
  return mailStatus;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function sendMail(subject, lines) {
  const text = lines.map((l) => (typeof l === 'string' ? l : `${l.label}: ${l.value}`)).join('\n');
  if (!mailEnabled()) {
    console.log(`[mail disabled] ${subject}\n${text}\n`);
    return { skipped: true };
  }
  const rows = lines
    .map((l) =>
      typeof l === 'string'
        ? `<tr><td colspan="2" style="padding:8px 0;font-weight:600">${esc(l)}</td></tr>`
        : `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(l.label)}</td><td style="padding:4px 0">${esc(l.value)}</td></tr>`
    )
    .join('');
  const link = config.publicUrl ? `<p><a href="${esc(config.publicUrl)}">Open ${esc(config.appName)}</a></p>` : '';
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px"><h2 style="margin:0 0 12px">${esc(subject)}</h2><table>${rows}</table>${link}</div>`;
  try {
    await transport.sendMail({ from: config.smtp.from, to: config.smtp.to.join(','), subject, text, html });
    console.log(`[mail sent] ${subject}`);
    onSent({ t: Date.now(), subject, ok: true, to: config.smtp.to.length });
    Object.assign(mailStatus, { verified: true, verifyError: null, verifiedAt: Date.now() });
    return { sent: true };
  } catch (err) {
    console.error(`[mail error] ${subject}: ${err.message}`);
    onSent({ t: Date.now(), subject, ok: false, error: err.message });
    return { error: err.message };
  }
}
