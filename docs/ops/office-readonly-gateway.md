# Kotovela Hub Office Read-only Gateway

This gateway is the public-facing safety layer for live internal data.

It must be used instead of exposing the full local `office-api` when a tunnel is reachable from the public internet.

## What It Exposes

Allowed read-only paths:

- `GET /api/office-instances`
- `GET /api/model-usage`
- `GET /api/tasks-board`

Guard behavior:

- Missing or wrong bearer token returns `401`.
- Write methods return `405`.
- Non-allowlisted API paths return `404`.

## Local Services

The full office API should stay local-only:

```bash
OFFICE_API_HOST=127.0.0.1 OFFICE_API_PORT=8787 ./scripts/install-office-bridge-runtime-launchd.sh
```

The public tunnel should point to the read-only gateway:

The same installer deploys the gateway and the Cloudflare connector. The legacy
component installer names are compatibility wrappers for this command.

All three bridge processes are user-level launchd agents:

- `com.kotovela.office-api`
- `com.kotovela.office-readonly-gateway`
- `com.kotovela.cloudflare-readonly-tunnel`

The bridge runs from a versioned release below
`~/Library/Application Support/Kotovela/office-bridge-runtime`, not from the Git
worktree. Mutable state is kept in the sibling `state` directory, credentials
remain under `~/.config/kotovela` with mode `600`, and logs are written below
`~/Library/Logs/Kotovela/office-bridge`.

The 10-minute snapshot job is deployed from its own `snapshot-current` release
pointer as `com.kotovela.office-snapshot-sync`. It writes only to the runtime
`state` directory and the dedicated `kotovela-workbench-sync` replica; it no
longer writes the development worktree and can be updated independently from
the API/gateway/tunnel chain.

List releases and roll back by explicit release id:

```bash
./scripts/rollback-office-bridge-runtime-launchd.sh --list
./scripts/rollback-office-bridge-runtime-launchd.sh <release-id>
./scripts/rollback-office-snapshot-runtime-launchd.sh --list
./scripts/rollback-office-snapshot-runtime-launchd.sh <release-id>
```

Runtime secrets are stored outside the repository under `~/.config/kotovela/` and must not be committed.

## Vercel Upstream

Vercel should point only to the tunnel URL for the read-only gateway:

- `OFFICE_INSTANCES_UPSTREAM_URL=https://<tunnel-host>/api/office-instances`
- `MODEL_USAGE_UPSTREAM_URL=https://<tunnel-host>/api/model-usage`
- `OFFICE_INSTANCES_UPSTREAM_TOKEN=<read-only gateway token>`
- `MODEL_USAGE_UPSTREAM_TOKEN=<read-only gateway token>`
- `OFFICE_INSTANCES_UPSTREAM_ALLOW_HOSTS=<tunnel-host>`
- `MODEL_USAGE_UPSTREAM_ALLOW_HOSTS=<tunnel-host>`
- `INTERNAL_API_UPSTREAM_ALLOW_HOSTS=<tunnel-host>`

After any upstream variable change, redeploy the Vercel production project.

## Current Recommendation

For a stable fixed HTTPS upstream, prefer a Cloudflare named tunnel pointing to `http://127.0.0.1:8791`.

Temporary quick tunnels can restore live data quickly, but their hostnames can change and they do not provide uptime guarantees.

## Stable Cloudflare Named Tunnel

The final production shape is:

```text
Vercel internal APIs
  -> fixed Cloudflare hostname
  -> Mac mini cloudflared named tunnel
  -> 127.0.0.1:8791 read-only gateway
  -> 127.0.0.1:8787 full office API
```

Security boundary:

- The public hostname must point to `127.0.0.1:8791`, not `8787`.
- The read-only gateway token must be different from the full office API token.
- Only the Vercel API routes should know the read-only gateway token.
- Keep Cloudflare tunnel credentials under `~/.cloudflared/`; do not commit them.

One-time Cloudflare account authorization:

```bash
cloudflared tunnel login
```

If this fails with `Failed to write the certificate`, download `cert.pem` from the browser flow and place it at:

```bash
mkdir -p ~/.cloudflared
chmod 700 ~/.cloudflared
mv ~/Downloads/cert.pem ~/.cloudflared/cert.pem
chmod 600 ~/.cloudflared/cert.pem
```

Create the fixed read-only tunnel and DNS route:

```bash
KOTOVELA_CLOUDFLARE_HOSTNAME=office-api.<your-cloudflare-domain> \
  ./scripts/bootstrap-cloudflare-readonly-tunnel.sh
```

If `cloudflared tunnel login` cannot write `~/.cloudflared/cert.pem`, use the Cloudflare Zero Trust dashboard token flow instead:

1. Open Cloudflare Zero Trust.
2. Go to `Networks` -> `Tunnels`.
3. Create a tunnel named `kotovela-office-readonly`.
4. Add one public hostname, for example `office-api.<your-cloudflare-domain>`.
5. Set the public hostname service to `http://127.0.0.1:8791`.
6. Copy the connector token from Cloudflare.
7. Read it without putting the secret in shell history, then install the local launchd connector:

```bash
read -s 'KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN?Cloudflare Tunnel token: '
export KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN
KOTOVELA_CLOUDFLARE_HOSTNAME=office-api.<your-cloudflare-domain> \
  ./scripts/install-office-bridge-runtime-launchd.sh
unset KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN
```

The installer immediately moves the token to `~/.config/kotovela/cloudflare-readonly-tunnel.token` with mode `600`; the launchd process uses `--token-file`, so the token is not visible in process arguments. Token mode does not require `cert.pem`. The public hostname and local service target are managed in the Cloudflare dashboard.

To rotate an existing or exposed token, select **Refresh token** in the Tunnel overview, copy the newly generated connector token, and replace the protected local file through the installer:

```bash
read -s 'KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN?New Cloudflare Tunnel token: '
export KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN
KOTOVELA_CLOUDFLARE_REPLACE_TUNNEL_TOKEN_FILE=1 \
  ./scripts/install-office-bridge-runtime-launchd.sh
unset KOTOVELA_CLOUDFLARE_TUNNEL_TOKEN
```

Confirm the dashboard reports `Healthy`, `npm run check:office-readonly-gateway` passes, and the `cloudflared` process contains `--token-file` but no `--token` argument. For an exposed token, also verify that no unexpected connectors remain in the Tunnel overview.

If a DNS record already exists and you intentionally want to replace it:

```bash
KOTOVELA_CLOUDFLARE_HOSTNAME=office-api.<your-cloudflare-domain> \
KOTOVELA_CLOUDFLARE_OVERWRITE_DNS=1 \
  ./scripts/bootstrap-cloudflare-readonly-tunnel.sh
```

Install the named tunnel as a user launchd agent:

```bash
./scripts/install-office-bridge-runtime-launchd.sh
```

Launchd service:

- `com.kotovela.cloudflare-readonly-tunnel`

Logs:

- `~/Library/Logs/Kotovela/office-bridge/cloudflare-readonly-tunnel.log`
- `~/Library/Logs/Kotovela/office-bridge/cloudflare-readonly-tunnel.error.log`

Local health checks:

```bash
npm run check:office-readonly-gateway
```

Public hostname checks:

```bash
curl -fsS https://office-api.<your-cloudflare-domain>/healthz

OFFICE_READONLY_GATEWAY_CHECK_URL=https://office-api.<your-cloudflare-domain> \
  npm run check:office-readonly-gateway
```

## Vercel Cutover To Stable Hostname

After the fixed Cloudflare hostname passes the checks above, update Production environment variables:

```text
OFFICE_INSTANCES_UPSTREAM_URL=https://office-api.<your-cloudflare-domain>/api/office-instances
MODEL_USAGE_UPSTREAM_URL=https://office-api.<your-cloudflare-domain>/api/model-usage
OFFICE_INSTANCES_UPSTREAM_TOKEN=<read-only gateway token>
MODEL_USAGE_UPSTREAM_TOKEN=<read-only gateway token>
OFFICE_INSTANCES_UPSTREAM_ALLOW_HOSTS=office-api.<your-cloudflare-domain>
MODEL_USAGE_UPSTREAM_ALLOW_HOSTS=office-api.<your-cloudflare-domain>
INTERNAL_API_UPSTREAM_ALLOW_HOSTS=office-api.<your-cloudflare-domain>
```

Then redeploy `kotovelahub` Production and verify:

```bash
curl -fsS https://kotovelahub.vercel.app/api/office-instances
curl -fsS https://kotovelahub.vercel.app/api/model-usage
curl -fsS https://kotovelahub.vercel.app/api/tasks-board
```

Expected result:

- `/api/office-instances` returns `source: "live"`.
- `/api/model-usage` returns `source: "local-openclaw"` or `partial` with explicit warnings.
- `/api/tasks-board` returns a non-zero `total` when local task data exists.

Only after this cutover is verified should the temporary Cloudflare quick tunnel be stopped.
