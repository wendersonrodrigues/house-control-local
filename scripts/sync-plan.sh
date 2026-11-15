#!/usr/bin/env bash
# Copia a planta salva no editor do Mac ("Casa · salva no editor") para a planta que vai junto
# com os apps (web/public/plans/homeos.json): o iPad e o painel "HomeOs 3D" do HA usam essa.
#
#   ./scripts/sync-plan.sh                 # só copia e mostra o que mudou
#   ./scripts/sync-plan.sh --ipad          # copia e reinstala no iPad ligado ao Mac
#   ./scripts/sync-plan.sh --ha            # copia e atualiza o painel do HA da casa
#   ./scripts/sync-plan.sh --ipad --ha     # as duas coisas
#
# A planta do Mac fica em ~/Library/Application Support/HouseControl/plan.json
# (PLAN=<arquivo> usa outra). A anterior fica em build/homeos.antes.json (fora do app).
set -euo pipefail
cd "$(dirname "$0")/.."

src="${PLAN:-$HOME/Library/Application Support/HouseControl/plan.json}"
dst="web/public/plans/homeos.json"
HA_DEST="${HA_DEST:-docker://wenderson@192.168.0.11/homeassistant}"

ipad=false; ha=false
for arg in "$@"; do
  case "$arg" in
    --ipad) ipad=true ;;
    --ha) ha=true ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opção desconhecida: $arg (use --ipad, --ha)" >&2; exit 2 ;;
  esac
done

[[ -f "$src" ]] || { echo "Não achei a planta do Mac em: $src" >&2; echo "Abra o editor no app do Mac e salve a casa primeiro." >&2; exit 1; }

# Mesmo formato da planta do repositório (indentação de 2, acentos como texto), e só se for
# uma planta válida: rooms, lights e o nome.
mkdir -p build
python3 - "$src" "$dst" build/homeos.antes.json <<'PY'
import json, sys, shutil, os
src, dst, backup = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, encoding="utf-8") as f:
    new = json.load(f)
for key in ("name", "rooms", "lights"):
    if key not in new:
        sys.exit(f"A planta do Mac não parece válida (falta '{key}').")
old = None
if os.path.exists(dst):
    with open(dst, encoding="utf-8") as f:
        old = json.load(f)
if old == new:
    print("A planta do app já é igual à do Mac. Nada a copiar.")
    sys.exit(0)
if old is not None:
    shutil.copyfile(dst, backup)
with open(dst, "w", encoding="utf-8") as f:
    f.write(json.dumps(new, indent=2, ensure_ascii=False) + "\n")

def ids(plan, group):
    return {x.get("id"): x for x in plan.get(group, [])}
print(f"Planta “{new['name']}” copiada do Mac para {dst}.")
if old is not None:
    for group, label in (("rooms", "cômodos"), ("lights", "luzes"), ("acs", "ares"), ("tvs", "TVs"),
                         ("gates", "portões"), ("furniture", "móveis"), ("openings", "portas e janelas")):
        a, b = ids(old, group), ids(new, group)
        added = [k for k in b if k not in a]
        removed = [k for k in a if k not in b]
        changed = [k for k in b if k in a and a[k] != b[k]]
        if added or removed or changed:
            parts = []
            if added: parts.append(f"+{len(added)}")
            if removed: parts.append(f"-{len(removed)}")
            if changed: parts.append(f"{len(changed)} alterados")
            print(f"  {label}: {', '.join(parts)}")
    unlinked = [x.get("name") or x.get("id") for g in ("lights", "acs", "tvs", "gates")
                for x in new.get(g, []) if not (x.get("link") or {}).get("id")]
    if unlinked:
        print("  sem vínculo com o HA (aparecem simulados): " + ", ".join(unlinked))
PY

if $ipad; then
  echo "Reinstalando no iPad…"
  ./scripts/build-ios.sh --install
fi
if $ha; then
  echo "Atualizando o painel do HA ($HA_DEST)…"
  ./scripts/deploy-ha.sh "$HA_DEST"
fi
if ! $ipad && ! $ha; then
  echo "Para levar ao iPad: ./scripts/sync-plan.sh --ipad (ou ./scripts/build-ios.sh --install)."
fi
