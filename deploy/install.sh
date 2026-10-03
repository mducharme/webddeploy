#!/usr/bin/env bash
# Installs (or upgrades) webddeploy on a ddeploy server, from this
# checkout. Run as root, after `ddeploy init-web` (which creates the
# ddeploy-web user, its sudoers rule and the nginx vhost):
#
#   sudo git clone <webddeploy-repo> /opt/webddeploy
#   sudo /opt/webddeploy/deploy/install.sh
#
# Upgrades: sudo git -C /opt/webddeploy pull && sudo /opt/webddeploy/deploy/install.sh
#
# The checkout stays root-owned — same rule as ddeploy's own: the process
# that runs the code (ddeploy-web) can't rewrite it.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_USER="${WEB_USER:-ddeploy-web}"

die() { printf '[error] %s\n' "$*" >&2; exit 1; }
info() { printf '[info]  %s\n' "$*" >&2; }

[[ "$EUID" -eq 0 ]] || die "run as root"
[[ "$APP_DIR" == /opt/webddeploy ]] || info "note: installing from $APP_DIR (the unit expects /opt/webddeploy)"
id -u "$WEB_USER" >/dev/null 2>&1 || die "no '$WEB_USER' user — run 'ddeploy init-web' first"
[[ -f /etc/sudoers.d/ddeploy-web ]] || die "no /etc/sudoers.d/ddeploy-web — run 'ddeploy init-web' first"

# Node >= 22.18 (TypeScript type stripping on by default). ddeploy's own
# root-owned nvm toolchain (/opt/nvm) usually has one.
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }
NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
    for cand in "$(command -v node || true)" $(ls -d /opt/nvm/versions/node/v*/bin/node 2>/dev/null | sort -V -r); do
        [[ -n "$cand" && -x "$cand" ]] && node_ok "$cand" && { NODE_BIN="$cand"; break; }
    done
fi
[[ -n "$NODE_BIN" ]] && node_ok "$NODE_BIN" || die "need Node >= 22.18 (set NODE_BIN=/path/to/node)"
info "using node $("$NODE_BIN" --version) at $NODE_BIN"
NODE_DIR="$(dirname "$NODE_BIN")"
[[ -x "$NODE_DIR/corepack" ]] || die "no corepack next to $NODE_BIN (Node 25+ dropped it) — use a Node 22/24 LTS build"

chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
cd "$APP_DIR"
PATH="$NODE_DIR:$PATH" "$NODE_DIR/corepack" pnpm install --frozen-lockfile
PATH="$NODE_DIR:$PATH" "$NODE_DIR/corepack" pnpm build

install -d -m 700 -o "$WEB_USER" -g "$WEB_USER" /var/lib/webddeploy
install -d -m 750 -o root -g "$WEB_USER" /etc/webddeploy
if [[ ! -f /etc/webddeploy/env ]]; then
    install -m 640 -o root -g "$WEB_USER" deploy/env.example /etc/webddeploy/env
    info "wrote /etc/webddeploy/env from the example — fill in PUBLIC_URL, GOOGLE_*, SUPERADMIN_EMAILS, then: systemctl restart webddeploy"
fi

sed "s#@NODE_BIN@#$NODE_BIN#" deploy/webddeploy.service > /etc/systemd/system/webddeploy.service
systemctl daemon-reload
systemctl enable webddeploy >/dev/null 2>&1

# Not configured yet (first install): starting would only fail on the
# missing settings — say what to fill in instead.
missing=""
for key in PUBLIC_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    val="$(sed -n "s/^$key=//p" /etc/webddeploy/env | tail -n 1)"
    [[ -n "$val" && "$val" != *example.com* ]] || missing+=" $key"
done
# At least one super-admin or admin (pre-roles env files only have ADMIN_EMAILS).
people="$(sed -n -e 's/^SUPERADMIN_EMAILS=//p' -e 's/^ADMIN_EMAILS=//p' /etc/webddeploy/env | grep -v 'example\.com' | tr -d ' ,\n')"
[[ -n "$people" ]] || missing+=" SUPERADMIN_EMAILS"
if [[ -n "$missing" ]]; then
    info "installed, not started: set$missing in /etc/webddeploy/env (sudoedit /etc/webddeploy/env), then: sudo systemctl restart webddeploy"
    exit 0
fi
systemctl restart webddeploy
sleep 2
port="$(sed -n 's/^PORT=//p' /etc/webddeploy/env)"
if curl -fsS -m 3 "http://127.0.0.1:${port:-8790}/healthz" >/dev/null; then
    info "webddeploy is up on 127.0.0.1:${port:-8790} — 'ddeploy doctor' reports it too"
else
    die "webddeploy didn't come up — journalctl -u webddeploy"
fi
