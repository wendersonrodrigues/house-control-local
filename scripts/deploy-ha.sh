#!/usr/bin/env bash
# Builds the web app and installs it into a Home Assistant's www folder, where HA serves it
# at /local/homeos/ (the tablet edition: it signs in with HA's own login, no token here).
#
#   ./scripts/deploy-ha.sh tools/lab/.ha/config/www                 # the lab, on this Mac
#   ./scripts/deploy-ha.sh usuario@192.168.0.11:/caminho/do/config/www   # the real one, over SSH
#   ./scripts/deploy-ha.sh docker://wenderson@192.168.0.11/homeassistant # the house: www belongs to root,
#                                                                        # so it goes in through the container
#
# The first time a www folder is created, Home Assistant must be restarted to serve /local/.
# Then open http(s)://<ha>/local/homeos/index.html, or add a "Página da web" dashboard with it.
set -euo pipefail
cd "$(dirname "$0")/.."

dest="${1:?uso: $0 <pasta www do Home Assistant | usuario@host:/caminho/www>}"
dest="${dest%/}"

(cd web && npm run build --silent)
# Home Assistant tells browsers to keep /local/ files for a month. So the app itself is
# app.html?v=<version>, and index.html (never changes) asks for the current version first.
stamp=$(date +%Y%m%d%H%M%S)
# A loading screen (the app icon and what it is doing) from the first paint until the panel
# is on screen: main.js writes the steps into it and fades it out.
splash_css='#splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:#040D17;color:rgba(233,237,242,.64);font:500 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;transition:opacity .4s}#splash.gone{opacity:0;pointer-events:none}#splash img{width:96px;height:96px;border-radius:22px;animation:sp 1.8s ease-in-out infinite}#splash .splash-bar{width:132px;height:3px;border-radius:3px;background:rgba(145,204,255,.14);overflow:hidden}#splash .splash-bar i{display:block;width:40%;height:100%;border-radius:3px;background:#8ccbe9;animation:sb 1.2s ease-in-out infinite}@keyframes sp{50%{transform:scale(.95);opacity:.85}}@keyframes sb{from{transform:translateX(-100%)}to{transform:translateX(250%)}}'
splash_html='<div id="splash"><img src="./img/apple-touch-icon.png" alt="" /><div class="splash-bar"><i></i></div><div class="splash-text">Carregando…</div></div>'
sed -e "s|<title>HomeOs Bar</title>|<title>HomeOs</title><style>$splash_css</style>|" \
    -e "s|<body>|<body>$splash_html|" web/dist/index.html > web/dist/app.html
grep -q 'id="splash"' web/dist/app.html || { echo "A tela de carregamento não entrou em app.html" >&2; exit 1; }
printf '%s' "$stamp" > web/dist/version.txt
cat > web/dist/index.html <<'HTML'
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" /><meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="HomeOs" /><meta name="theme-color" content="#040D17" />
<link rel="apple-touch-icon" href="./img/apple-touch-icon.png" /><link rel="manifest" href="./manifest.webmanifest" />
<title>HomeOs</title><style>html,body{margin:0;height:100%;background:#040D17}body{display:flex;align-items:center;justify-content:center}img{width:96px;height:96px;border-radius:22px}</style></head>
<body><img src="./img/apple-touch-icon.png" alt="" /><script>
  var q = location.search.replace(/^\?/, '');
  var go = function (v) { location.replace('app.html?' + (v ? 'v=' + v + (q ? '&' : '') : '') + q + location.hash); };
  fetch('version.txt', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (v) { go(v.trim()); }, function () { go(''); });
</script></body></html>
HTML

if [[ "$dest" == docker://* ]]; then
  spec="${dest#docker://}"; host="${spec%%/*}"; container="${spec#*/}"
  rsync -az --delete web/dist/ "$host:/tmp/homeos-staging/"
  ssh "$host" "docker exec $container sh -c 'rm -rf /config/www/homeos && mkdir -p /config/www/homeos' \
    && docker cp /tmp/homeos-staging/. $container:/config/www/homeos && rm -rf /tmp/homeos-staging"
  dest="$host ($container:/config/www)"
elif [[ "$dest" == *:* ]]; then
  rsync -az --delete web/dist/ "$dest/homeos/"
else
  mkdir -p "$dest/homeos"
  rsync -a --delete web/dist/ "$dest/homeos/"
fi
echo "Instalado em $dest/homeos (versão $stamp)."
echo "Abra /local/homeos/index.html no Home Assistant (a página de entrada sempre pega a versão nova)."
