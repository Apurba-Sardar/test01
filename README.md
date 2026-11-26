# TMJ Dashboard

The office's internal web-operations dashboard for all **TMJ** websites: **WordPress** and **Next.js** uptime, incidents, SEO health, renewals and Domain Authority in one CRM-style app.

**Pages**
- **Overview:** greeting, a status banner, and headline numbers: websites, operational, issues, average response, uptime and average DA. It also has "Sites at a glance", a "Needs attention" to-do list, response time by site, status and platform split, upcoming renewals and live activity.
- **Sites:** a sortable, filterable table of every website, with its status, pages, recent checks, response time, uptime, DA, SSL and health. You can export it as CSV.
- **Site record:** opens when you click a website. It has a header with actions (check now, run health checks, pause, visit) and four tabs: *Overview* (stats, response-time chart, pages, 30-day uptime), *Health & SEO*, *Activity* and *Configuration*.
- **Incidents:** the full outage and recovery history with summary numbers, filters, search and CSV export.
- **Health & SEO:** a grid of every website against every check, plus an "Issues to fix" list.
- **Domains & SSL:** a renewal schedule (domain registration and SSL expiry), DA and spam score, with CSV export.
- **Settings & alerts:** monitoring, email, integration and system status, a test-email button, and the outgoing IP.

The app also has a sidebar with live badges, a top bar with global search (press `/`), a notifications bell, a light/dark switch, and a phone layout with a slide-out menu.

**Features**
- **Login page** with secure sessions ("keep me signed in for 30 days"), brute-force lockout and sign-out.
- **Live dashboard** that updates in real time: totals for all sites, WordPress, Next.js, up and down, plus average response time and uptime.
- Each site shows its status, response time, 24-hour uptime, bars for its last 60 checks, and how many days are left on its SSL certificate.
- **Email alerts** when a site goes **down**, a **reminder** while it stays down, a mail when it **recovers** (with the downtime), and a warning when its **SSL certificate is close to expiring**.
- If several sites fail in the same check cycle (for example a shared server goes down), you get **one email** listing all of them, not one email per site.
- **Smart checks**:
  - WordPress sites are also marked down when the page shows *"Error establishing a database connection"*, *"critical error"* or the maintenance-mode page.
  - Next.js sites are also marked down when the page shows *"Application error"*.
  - You can require a keyword on any page.
- **No false alarms from one blip**: a site is marked down only after `FAIL_THRESHOLD` failures in a row (default 2).
- Cloudflare challenge pages are detected and shown as **Blocked**, not as false outages (see below).
- **Homepage + article page** are checked for every site. The article is found automatically (latest WordPress post, or a recent page from the sitemap), or you can set `articleUrl` in `sites.json`.
- **Health & SEO checks** every few hours: HTTP→HTTPS redirect, SSL, domain expiry, robots.txt (does it block search engines?), XML sitemap, noindex on the homepage, title & meta description, CSS/JS files loading, and for WordPress the REST API and RSS feed. Newly failing checks are emailed.
- **Domain Authority** (Moz DA) per site, refreshed weekly, when `MOZ_API_TOKEN` is set.
- **Site detail panel** (click any site): response-time chart, 30-day uptime bars, uptime for 24h / 7d / 30d, every page checked, health results, DA and the site's event history.
- **Pause for maintenance**: pause a site from its detail panel. No checks and no alerts until you resume.
- Light/dark theme switch, sorting, search (press `/`), and a footer with the monitor's settings and outgoing IP.
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
| `enabled` | — | `false` removes the site from monitoring |
| `articleUrl` | — | Article page to check. Leave it out to find one automatically, or set it to `false` to skip the article check. |
| `pages` | — | Extra pages to check, for example `[{ "name": "Contact", "url": "https://…/contact", "keyword": "Send" }]` |

The file is **reloaded automatically** when you save it, so you don't need to restart.
(With Docker, editors that replace the file can break the single-file mount. If edits don't show up, run `docker compose restart`.)

## History & data storage

Everything is stored in plain files in the data folder (`DATA_DIR`, by default `~/tmj-dashboard-data` on Hostinger):

| File | What it holds | Kept |
|---|---|---|
| `state.json` | Current status, last 24 h of checks (charts), 90 days of hourly totals, **daily totals per site** | Daily totals forever |
| `checks/YYYY-MM-DD.ndjson` | **Every single check** (result, response time, HTTP code, error, homepage & article results) | `LOG_RETENTION_DAYS` (default 365; `0` = forever) |
| `incidents.ndjson` | Every event: down, recovered, blocked, slow, health check failed/fixed, paused/resumed | Forever |
| `health.ndjson` | Every health & SEO check run | Forever |
| `da.ndjson` | Every Domain Authority reading | Forever |

- The log files are append-only: new lines are added and nothing is rewritten, so old data isn't lost if the app crashes mid-save.
- **Hostinger:** the app folder (`…/hbuilds/…`) is replaced on every deploy. If the data folder would be inside it, the app uses `~/tmj-dashboard-data` instead and copies any existing history there once.
- **Storage use:** about 0.7 MB a day for 6 sites at one check a minute, so roughly 250 MB a year with the default retention.
- **Reports & history** page: monthly uptime, average response, outages and downtime per site, for the last 6–36 months.
- **Downloads** (Settings & alerts → Data & storage): check log (7/30/90/365 days or everything), daily uptime, all incidents, health history and DA history, all as CSV.
- **Backup:** copy the data folder (for example, download it with Hostinger's File Manager).

## Domain Authority (Moz)

1. Create a Moz API token at <https://moz.com/products/api>. A free plan with a small monthly quota is available.
2. Set `MOZ_API_TOKEN` in `.env`, or under Environment variables on Hostinger.
3. DA is fetched once per site every `DA_REFRESH_DAYS` (default 7), which uses about 26 API rows a month for 6 sites. The detail panel also shows the spam score and the previous DA value.

## Sites behind Cloudflare (important)

Cloudflare's bot protection can answer the monitor with a challenge page ("Just a moment…" or "Attention Required!") instead of your site. In that case the monitor can't see whether your site is up.

The monitor detects these challenge pages and shows the site as **Blocked** (an orange ring). Blocked checks never send alerts and don't count against uptime. But while a site is blocked, it isn't really being monitored. To let the monitor through, do one of these on each Cloudflare zone:

1. **Allow the monitor's server IP (simplest).** Go to *Security → WAF → Tools → IP Access Rules*, add your monitor server's IP and choose **Allow**.
2. **Use a secret header.** Set `MONITOR_TOKEN` in `.env`. Then create a WAF custom rule (*Security → WAF → Custom rules*):
   - Expression: `(http.request.headers["x-status-monitor"][0] eq "YOUR_TOKEN")`
   - Action: **Skip**, and tick all the remaining custom rules, rate limiting, managed rules and Super Bot Fight Mode.
   - Put the rule first.

The free plan's *Bot Fight Mode* can't be bypassed with rules. If it's on and a site stays Blocked, turn it off for that zone or use option 1. Cloudflare changes these menus often, so check their docs if a menu name differs.

Real outages are still caught when Cloudflare is in front of a site. If the origin server is down, Cloudflare returns HTTP 520–526 (or 502/503/504), and the monitor reports that as **DOWN**.

## Gmail setup (used for alerts)

1. Choose the Gmail or Google Workspace account that will **send** the alerts. A dedicated account such as `alerts@…` works well.
2. Turn on **2-Step Verification** for that account. App passwords require it.
3. Go to <https://myaccount.google.com/apppasswords>, create an app password named "Status Monitor", and copy the 16-character code.
4. In `.env`, set:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=the-sending-account@yourdomain.com
   SMTP_PASS=the16charapppassword   # no spaces
   ALERT_EMAIL_FROM="Site Status Monitor <the-sending-account@yourdomain.com>"
   ALERT_EMAIL_TO=you@yourdomain.com
   ```
5. Restart the monitor, then click **Test email** on the dashboard.

Possible problems:
- **App passwords page says the setting isn't available:** on Google Workspace, an admin may need to allow it. In the Admin console, go to *Security → Authentication → 2-step verification*.
- **Daily sending limit:** Gmail allows about 500 emails a day, and Workspace about 2,000. The monitor sends one email per check cycle, so it stays far below that.
- **Alerts go to spam:** add the sending address to your contacts, or create a filter that sets "Never send to Spam".

## Other email providers

| Provider | SMTP_HOST | SMTP_PORT | SMTP_SECURE | Notes |
|---|---|---|---|---|
| Gmail / Google Workspace | smtp.gmail.com | 465 | true | Use an [App Password](https://myaccount.google.com/apppasswords) |
| Amazon SES | email-smtp.<region>.amazonaws.com | 587 | false | SMTP credentials from SES |
| SendGrid | smtp.sendgrid.net | 587 | false | user `apikey`, pass = API key |
| Mailgun | smtp.mailgun.org | 587 | false | |
| Zoho | smtp.zoho.com | 465 | true | |

`ALERT_EMAIL_TO` takes a comma-separated list of addresses.

## Hosting on Hostinger

There are two ways to run the monitor on Hostinger. **Option A (VPS) is the most reliable.** Option B is easier if you already have a Business or Cloud plan.

> If your sites are hosted on Hostinger too, put the monitor on a **different** server (or a separate VPS). Otherwise one outage can take down your sites and the monitor together, and no alert email gets sent.

### Option A: Hostinger VPS with Docker (recommended)

A small VPS (KVM 1 is enough) keeps the monitor running 24/7, keeps its history, and lets you open any SMTP port.

1. In hPanel, open **VPS**, choose the **Ubuntu + Docker** template (or plain Ubuntu, then install Docker), and note the server's IP.
2. SSH in and run:
   ```bash
   git clone https://github.com/Apurba-Sardar/test01.git status && cd status
   cp .env.example .env && nano .env      # Gmail App Password, alert email, dashboard login
   docker compose up -d --build
   ```
3. Point a subdomain at the VPS IP, for example `status.themindsjournal.com` (an A record). Then put HTTPS in front of the app with Caddy, the simplest option:
   ```bash
   sudo apt install -y caddy
   echo 'status.themindsjournal.com {
     reverse_proxy 127.0.0.1:3000
   }' | sudo tee /etc/caddy/Caddyfile && sudo systemctl reload caddy
   ```
   Then set `PUBLIC_URL=https://status.themindsjournal.com` in `.env`.
4. In **Cloudflare**, allow the VPS IP for each site (see "Sites behind Cloudflare").
5. To update later, run `git pull && docker compose up -d --build`.

### Option B: Hostinger managed Node.js web app (Business / Cloud plans)

Use this option on Hostinger's Business or Cloud plans. It was written for **Cloud Enterprise Plus**.

**1. Create the app**
1. In hPanel, go to **Websites → Add Website → Node.js web app**.
2. Click **Connect with GitHub**, install the Hostinger GitHub App, and give it access to this repository.
3. Pick the repository and use these deploy settings:

   | Setting | Value |
   |---|---|
   | Framework preset | **Other** |
   | Branch | `main` |
   | Node.js version | **22** |
   | Package manager | npm |
   | Build command | *(none)* |
   | Entry file | `src/server.js` |

**2. Set environment variables.** You can do this on the deploy screen, or later under **Environment variables** in the website sidebar. *Import .env* lets you paste them all at once. Saving redeploys the app.

```env
DASHBOARD_USER=admin
DASHBOARD_PASS=<strong password>
PUBLIC_URL=https://status.yourdomain.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<sending gmail account>
SMTP_PASS=<16-char app password>
ALERT_EMAIL_FROM=Site Status Monitor <sending gmail account>
ALERT_EMAIL_TO=<where alerts go>
CRON_TOKEN=<long random string>
DATA_DIR=/home/<your-hostinger-user>/status-data
```

- **`DATA_DIR`:** each deploy replaces the app folder (`hbuilds/…`), so keep the history file outside it. Your home path is shown in **File Manager** and looks like `/home/u123456789`.
- **`PORT`:** don't set it. Hostinger provides it.

**3. Add a cron job (important).** Hostinger notes that timers inside an app stop whenever the app is redeployed or restarted, and it recommends cron jobs for scheduled work. The cron job keeps checks running no matter what happens to the process.

In hPanel, go to **Advanced → Cron Jobs** and add a job that runs **every minute**:
```bash
curl -fsS --max-time 110 "https://status.yourdomain.com/api/cron?token=<CRON_TOKEN>" > /dev/null
```
If the built-in timer is also running, the monitor skips the extra round, so failures are never counted twice.

**4. Domain.** In the website dashboard, click **Connect domain** and use a subdomain such as `status.yourdomain.com`. Hostinger installs SSL automatically. If the domain goes through Cloudflare, set SSL mode to **Full**.

**5. Check it works**
- Open the dashboard, log in, and click **Test email**. If it times out, outgoing SMTP may be blocked. Try `SMTP_PORT=587` with `SMTP_SECURE=false`, or ask Hostinger support to open the port.
- Look at **Runtime Logs** in the sidebar. You should see `monitoring 6 site(s)` and `Email alerts: enabled`.
- Allow the server's outgoing IP in Cloudflare for your sites (see "Sites behind Cloudflare"). The IP is printed in **Runtime Logs** as `Outgoing IP (allow this in Cloudflare): …`, and you can also open `/api/outgoing-ip` on the dashboard.

**Notes for Hostinger**
- **Live connection:** Hostinger stops any request after 120 seconds. The live dashboard connection renews itself every ~100 seconds, so you won't notice.
- **Deploys:** every push to `main` redeploys automatically, including edits to `sites.json`.

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

All endpoints except `/healthz`, `/login` and `/api/cron` need you to be signed in.

- `POST /api/login` / `POST /api/logout`: sign in or out (cookie session). Scripts can also use HTTP Basic auth (`curl -u user:pass`).
- `GET /api/status`: JSON snapshot of every site
- `GET /api/sites/:id`: full detail for one site (24h history, 30-day hourly uptime, health checks, events)
- `POST /api/sites/:id/check`, `POST /api/sites/:id/health`: run that site's checks or health checks now
- `POST /api/sites/:id/pause` with `{"paused": true|false}`: maintenance mode
- `GET /api/storage`: data folder, size and record counts
- `GET /api/reports/monthly?months=12`: monthly uptime, response time, outages and downtime per site
- `GET /api/export/checks.csv?days=30&site=`, `/api/export/daily.csv`, `/api/export/incidents.csv`, `/api/export/health.csv`, `/api/export/da.csv`: CSV downloads
- `GET /api/events`: live stream of updates (Server-Sent Events)
- `POST /api/check-all`, `POST /api/check/:id`: run checks now
- `GET /api/outgoing-ip`: the server's public outgoing IP, which is the one to allow in Cloudflare
- `POST /api/test-email`: send a test alert
- `GET /api/cron?token=CRON_TOKEN`: run a round of checks (for cron jobs); uses the token instead of the login
- `GET /healthz`: liveness check, no login required
