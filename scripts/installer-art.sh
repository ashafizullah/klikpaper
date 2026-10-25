#!/usr/bin/env bash
# Renders design/installer/art.html into the installer images in src-tauri/installer:
# 24-bit BMPs for NSIS and WiX, and a 1x+2x TIFF for the DMG window.
# Needs Google Chrome, Python 3 with Pillow, and macOS tiffutil.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=src-tauri/installer
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
page="file://$PWD/design/installer/art.html"

shot() { # name width height scale
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor="$4" --window-size="$2,$3" --virtual-time-budget=2000 \
    --screenshot="$TMP/$1@$4.png" "$page#k=$1" 2>/dev/null
}

shot nsis-sidebar 164 314 1
shot nsis-header 150 57 1
shot wix-banner 493 58 1
shot wix-dialog 493 312 1
shot dmg 660 400 1
shot dmg 660 400 2

python3 - "$TMP" "$OUT" <<'PY'
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
for name in ["nsis-sidebar", "nsis-header", "wix-banner", "wix-dialog"]:
    Image.open(f"{tmp}/{name}@1.png").convert("RGB").save(f"{out}/{name}.bmp")
for scale in (1, 2):
    img = Image.open(f"{tmp}/dmg@{scale}.png").convert("RGB")
    img.save(f"{tmp}/dmg@{scale}.tiff", dpi=(72 * scale, 72 * scale))
PY
tiffutil -cathidpicheck "$TMP/dmg@1.tiff" "$TMP/dmg@2.tiff" -out "$OUT/dmg-background.tiff" >/dev/null
ls -l "$OUT"
