// Central configuration, read from environment variables.
// A local .env file is loaded if present; on hosts like Hostinger you can set the variables in the panel instead.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — use the real environment */
}
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  sitesFile: process.env.SITES_FILE || 'sites.json',
  dataDir: process.env.DATA_DIR || 'data',

  checkIntervalSec: num(process.env.CHECK_INTERVAL_SECONDS, 60),
  timeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 15000),
  slowThresholdMs: num(process.env.SLOW_THRESHOLD_MS, 5000),
  failThreshold: num(process.env.FAIL_THRESHOLD, 2), // consecutive failures before "down"
  concurrency: num(process.env.CHECK_CONCURRENCY, 10),
  realertMinutes: num(process.env.REALERT_MINUTES, 60), // 0 = never re-alert
  sslWarnDays: num(process.env.SSL_WARN_DAYS, 14),

  // Sent as the X-Status-Monitor header so a Cloudflare WAF rule can let the monitor through.
  monitorToken: process.env.MONITOR_TOKEN || '',

  dashboardUser: process.env.DASHBOARD_USER || '',
  dashboardPass: process.env.DASHBOARD_PASS || '',
  publicUrl: process.env.PUBLIC_URL || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || 'status-monitor@localhost',
    to: (process.env.ALERT_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};
