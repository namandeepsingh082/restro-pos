# Deploying to a permanent URL, free

The goal: a URL that never changes, live whether or not any laptop is open.

The app needs one thing no free serverless host provides — **a persistent disk**,
because the database is a single SQLite file. So it wants a small always-on VM.
Oracle Cloud's *Always Free* tier is the only genuinely free, no-time-limit option
that gives one. The app uses **122 MB of RAM and a 368 KB database**, so even the
smallest free shape is generous.

```
Oracle Always Free VM  ──  Caddy (HTTPS)  ──  pm2  ──  Next.js on 127.0.0.1:3000
        always on           auto-renewing      restarts       SQLite file on disk
                            certificate        on reboot
```

## What you do, once

**1. Create the VM.** cloud.oracle.com → sign up (a card is required for identity
verification; Always Free itself is not billed). Pick the region closest to the
shop — **Mumbai** or **Hyderabad**, not a US one, or every tap crosses an ocean.
Create a Compute instance:

- Image **Ubuntu 22.04 or 24.04**
- Shape **VM.Standard.A1.Flex** (ARM, 1–4 OCPU / 6–24 GB — all free). If it says
  *out of capacity*, try another availability domain, or take
  **VM.Standard.E2.1.Micro** instead; 1 GB is enough to run, and the swap this
  setup adds covers the build.
- Save the SSH key it offers. Note the **public IP**.

**2. Open the ports in Oracle's own firewall.** Networking → your VCN → Subnet →
Security List → **Add Ingress Rules**: source `0.0.0.0/0`, TCP ports **80** and
**443**. Ubuntu on Oracle *also* ships iptables rules that reject everything —
`provision.sh` handles that half. Both halves are required; missing either gives a
site that times out with no explanation.

**3. Get a hostname.** A certificate needs a name, not an IP.
- Free: **duckdns.org** → sign in with Google, create e.g. `pos-khalsa`, point it
  at the VM's public IP. You get `pos-khalsa.duckdns.org` permanently.
- Or your own domain (~₹900/year), which looks better on a customer's bill: an
  `A` record for `pos.yourshop.com` → the VM's IP.

## What the scripts do

From your laptop, in the project root:

```bash
# 1. one-time server setup  (Node, Caddy, pm2, swap, firewall, timezone)
ssh ubuntu@<server-ip>
DOMAIN=pos-khalsa.duckdns.org bash -s < deploy/provision.sh

# 2. copy the app up
deploy/sync.sh ubuntu@<server-ip>

# 3. first deployment  (writes .env with a fresh secret, database, build, pm2)
ssh ubuntu@<server-ip> 'cd /opt/restro-pos && bash deploy/first-run.sh'
```

Then open `https://pos-khalsa.duckdns.org`. Caddy fetches the certificate on the
first request, so give it a few seconds.

**Every deployment after that** is two commands:

```bash
deploy/sync.sh ubuntu@<server-ip>
ssh ubuntu@<server-ip> 'cd /opt/restro-pos && bash deploy/release.sh'
```

`release.sh` snapshots the database first, then installs, pushes the schema,
builds, and `pm2 reload`s — the new process starts before the old one stops, so a
cashier mid-bill sees nothing.

## Two things that must not be got wrong

**The database is on the server, not here.** `sync.sh` excludes `prisma/dev.db`
and `.env` for that reason. Without those excludes, a deploy would replace live
billing data with whatever was last tested on the laptop. If you ever want to
carry the current test data over, do it once, deliberately:

```bash
scp prisma/dev.db ubuntu@<server-ip>:/opt/restro-pos/prisma/dev.db
```

**The seeded password.** A fresh database is seeded with
`admin@restaurant.local / admin@123`, which is printed in this repository. The
server is on the public internet. Sign in and change both accounts under **Staff**
before anything else.

## Backups

`deploy/backup.sh` wraps `npm run backup` (SQLite's backup API — safe while the
app is serving, keeps the last 30 in `./backups`). A backup that only lives on the
server it protects is not a backup, so give it somewhere to go:

```bash
crontab -e
0 1 * * *  cd /opt/restro-pos && OFFSITE="you@somewhere:/backups/pos/" bash deploy/backup.sh >> logs/backup.log 2>&1
```

## When something is wrong

| Symptom | Look here |
|---|---|
| Site times out | Oracle ingress rules **and** `sudo iptables -L INPUT -n \| head` |
| Certificate error | `sudo journalctl -u caddy -n 50` — usually DNS not pointing at the VM yet |
| 502 from Caddy | app is down: `pm2 status`, `pm2 logs restro-pos` |
| Works on the IP, not the name | DuckDNS record stale, or DNS not propagated |
| Build killed | swap missing — re-run `provision.sh` |

## Honest limits of the free tier

Oracle can reclaim idle Always Free instances, and free-tier terms change. The
free shapes are also often capacity-constrained at creation time. None of that
loses your data *if* the off-box backup above is running. When this outgrows free
— or you simply want it to stop being someone's free tier — the same scripts
deploy unchanged to a ~₹400–500/month VPS (Hetzner, DigitalOcean); only the IP in
the commands changes.
