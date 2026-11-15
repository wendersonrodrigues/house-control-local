#!/bin/bash
# Builds the iPhone app for the simulator and launches it there.
#   ./scripts/ios-sim.sh                 build + install + launch on the booted simulator
#   HOUSE_SCREEN=settings ./scripts/ios-sim.sh   …opening on a given screen (settings, pairing, smartlife, welcome, home)
#   EDITION=appstore ./scripts/ios-sim.sh        …the App Store edition, without Smart Life
#   EDITION=smartlife ./scripts/ios-sim.sh       …the original's Smart Life edition
# HomeOs (default): ios/project-homeos.yml, on an iPad simulator unless DEVICE says otherwise.
#   DEVICE="iPhone 17 Pro" ./scripts/ios-sim.sh  …on another simulator (name or UDID)
# Any HOUSE_* variable set here is passed on to the app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EDITION="${EDITION:-homeos}"
if [ -z "${DEVICE:-}" ]; then
  if [ "$EDITION" = homeos ]; then
    # the first iPad simulator there is (iPad Pro first)
    DEVICE="$(xcrun simctl list devices available | grep -E '^ +iPad' \
      | awk '/iPad Pro/{print; next} {rest = rest $0 "\n"} END {printf "%s", rest}' \
      | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' | head -1)"
    [ -n "$DEVICE" ] || { echo "Nenhum simulador de iPad. Instale o iOS em Xcode → Settings → Components."; exit 1; }
  else
    DEVICE="iPhone 17 Pro"
  fi
fi
[[ "$DEVICE" =~ ^[0-9A-F-]{36}$ ]] && DEST="id=$DEVICE" || DEST="name=$DEVICE"

if [ -z "${SKIP_WEB:-}" ]; then
  cd "$ROOT/web"
  [ -d node_modules ] || npm install
  npm run build --silent
fi

cd "$ROOT/ios"
case "$EDITION" in
  appstore) SPEC=project.yml ;;
  smartlife) SPEC=project-smartlife.yml ;;
  *) SPEC=project-homeos.yml ;;
esac
xcodegen generate --spec "$SPEC" --quiet
xcodebuild -project HouseControl.xcodeproj -scheme HouseControl -configuration Debug \
  -destination "platform=iOS Simulator,$DEST" -derivedDataPath build/DerivedData \
  CODE_SIGN_IDENTITY=- build 2>&1 | grep -E "error|warning: |BUILD" | grep -v appintentsmetadataprocessor || true
APP="build/DerivedData/Build/Products/Debug-iphonesimulator/HouseControl.app"
[ -d "$APP" ] || { echo "Build failed"; exit 1; }
# Choosing a lamp, room or AC for a widget needs a signature with a team: the simulator's
# App Intents service ignores the entities of an ad-hoc signed app. Uses your Apple
# Development certificate when there is one (CODESIGN_IDENTITY=… picks another).
SIGN="${CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk '/Apple Development/{print $2; exit}')}"
if [ -n "$SIGN" ]; then
  for bundle in "$APP"/PlugIns/*.appex "$APP"; do
    codesign --force --sign "$SIGN" --preserve-metadata=entitlements "$bundle" >/dev/null 2>&1 || true
  done
fi

xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a Simulator 2>/dev/null || true # (Xcode 27 has no Simulator.app; the app runs headless)
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl install "$DEVICE" "$APP"
for name in $(compgen -v | grep '^HOUSE_' || true); do export "SIMCTL_CHILD_$name=${!name}"; done
xcrun simctl launch --terminate-running-process "$DEVICE" "$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist")"
