#!/usr/bin/env bash
# Copia o tema HomeOs para a pasta themes/ de um Home Assistant (que precisa ter
# "frontend: themes: !include_dir_merge_named themes" no configuration.yaml).
#
#   ./tools/ha-tema/instalar.sh tools/lab/.ha/config                      # o lab, neste Mac
#   ./tools/ha-tema/instalar.sh docker://wenderson@192.168.0.11/homeassistant   # a casa (pelo contêiner)
#
# Depois: Ferramentas de desenvolvedor → Ações → frontend.reload_themes, e escolher o tema
# no perfil (ou frontend.set_theme com name: HomeOs para ser o padrão de todos).
set -euo pipefail
cd "$(dirname "$0")/../.."
dest="${1:?uso: $0 <pasta config do HA | docker://usuario@host/contêiner>}"
src="tools/ha-tema/homeos.yaml"
python3 -c "import sys,yaml; yaml.safe_load(open('$src'))" 2>/dev/null || ruby -ryaml -e "YAML.load_file('$src')"
if [[ "$dest" == docker://* ]]; then
  spec="${dest#docker://}"; host="${spec%%/*}"; container="${spec#*/}"
  scp -q "$src" "$host:/tmp/homeos-theme.yaml"
  ssh "$host" "docker exec $container mkdir -p /config/themes/homeos && docker cp /tmp/homeos-theme.yaml $container:/config/themes/homeos/homeos.yaml && rm /tmp/homeos-theme.yaml"
else
  mkdir -p "$dest/themes/homeos"
  cp "$src" "$dest/themes/homeos/homeos.yaml"
fi
echo "Tema copiado para $dest (themes/homeos/homeos.yaml). Recarregue os temas no HA (frontend.reload_themes)."
