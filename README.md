# Site Status Monitor

An internal, self-hosted status page for all your **WordPress** and **Next.js** sites.

- **Live dashboard** that updates in real time: totals for all sites, WordPress, Next.js, up and down, plus average response time and uptime.
- Each site shows its status, response time, 24-hour uptime, bars for its last 60 checks, and how many days are left on its SSL certificate.
- **Email alerts** when a site goes **down**, a **reminder** while it stays down, a mail when it **recovers** (with the downtime), and a warning when its **SSL certificate is close to expiring**.
- If several sites fail in the same check cycle (for example a shared server goes down), you get **one email** listing all of them, not one email per site.
- **Smart checks**:
  - WordPress sites are also marked down when the page shows *"Error establishing a database connection"*, *"critical error"* or the maintenance-mode page.
  - Next.js sites are also marked down when the page shows *"Application error"*.
  - You can require a keyword on any page.
- **No false alarms from one blip**: a site is marked down only after `FAIL_THRESHOLD` failures in a row (default 2).
- Browser notifications, and the tab title shows how many sites are down (for example `(2 down)`).
- A login (HTTP Basic Auth) protects the page.
- One dependency (`nodemailer`) and no database. State is kept in `data/state.json`.

## Quick start

```bash
cp .env.example .env              # set SMTP + alert email + dashboard login
cp sites.example.json sites.json  # list your sites
npm install
npm start                         # → http://localhost:3000
```

Use the **Test email** button on the dashboard to check that your mail settings work.

### With Docker

```bash
cp .env.example .env && cp sites.example.json sites.json
docker compose up -d --build
```

## Adding sites — `sites.json`

```json
[
  { "name": "Main Blog", "url": "https://blog.example.com", "type": "wordpress" },
  { "name": "Shop", "url": "https://shop.example.com", "type": "wordpress", "keyword": "Add to cart" },
  { "name": "Marketing", "url": "https://www.example.com", "type": "nextjs" },
  { "name": "App API", "url": "https://app.example.com/api/health", "type": "nextjs", "expectedStatus": 200 }
]
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Display name |
| `url` | yes | URL to check |
| `type` | — | `wordpress`, `nextjs` or anything else. The dashboard counts and filters sites by type. |
| `keyword` | — | Text that must appear in the page. If it is missing, the site is counted as down. |
| `expectedStatus` | — | A number or a list of numbers. Default: any 2xx/3xx is OK. |
| `method` | — | `GET` (default) or `HEAD` |
| `headers` | — | Extra request headers, for example to get past a firewall that blocks bots |
| `timeoutMs` | — | Timeout for this site only |
| `group` | — | Label you can search for |
| `enabled` | — | `false` pauses monitoring |

The file is **reloaded automatically** when you save it, so you don't need to restart.
(With Docker, editors that replace the file can break the single-file mount. If edits don't show up, run `docker compose restart`.)

## Email setup examples

| Provider | SMTP_HOST | SMTP_PORT | SMTP_SECURE | Notes |
|---|---|---|---|---|
| Gmail / Google Workspace | smtp.gmail.com | 465 | true | Use an [App Password](https://myaccount.google.com/apppasswords) |
| Amazon SES | email-smtp.<region>.amazonaws.com | 587 | false | SMTP credentials from SES |
| SendGrid | smtp.sendgrid.net | 587 | false | user `apikey`, pass = API key |
| Mailgun | smtp.mailgun.org | 587 | false | |
| Zoho | smtp.zoho.com | 465 | true | |

`ALERT_EMAIL_TO` takes a comma-separated list of addresses.

## Where to run it

Run it on a server **separate from the servers hosting your sites**. If it runs on the same box, it goes down with them and can't email you. A small VPS works, and so does any always-on machine. Put it behind your reverse proxy (Nginx or Caddy) with HTTPS, and set `PUBLIC_URL` so the alert emails link to it.

Nginx: the live updates use Server-Sent Events, so disable buffering for `/api/events`:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
}
```

To keep it running without Docker, use `pm2 start npm --name status -- start` or a systemd service.

## API

All endpoints except `/healthz` use the dashboard login.

- `GET /api/status`: JSON snapshot of every site
- `GET /api/events`: live stream of updates (Server-Sent Events)
- `POST /api/check-all`, `POST /api/check/:id`: run checks now
- `POST /api/test-email`: send a test alert
- `GET /healthz`: liveness check, no login required
