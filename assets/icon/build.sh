#!/bin/sh
# Regenerates every raster icon from lectern-icon.svg (the tray template is separate).
# Needs macOS 14+ (AppKit SVG loading), swift, iconutil and python3.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
icons="$root/assets/icons"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

set --
for s in 16 32 128 256 512; do
  set -- "$@" "$s:$tmp/icon_${s}x${s}.png" "$((s * 2)):$tmp/icon_${s}x${s}@2x.png"
done
for s in 24 48 64; do set -- "$@" "$s:$tmp/ico-$s.png"; done
swift "$here/render.swift" "$here/lectern-icon.svg" "$@" \
  512:"$icons/icon.png" \
  128:"$root/static/favicon.png"

# Electrobun takes the macOS icon as an .iconset folder (it makes the .icns itself); the .icns is for everything else.
rm -rf "$icons/icon.iconset"
mkdir "$icons/icon.iconset"
cp "$tmp"/icon_*.png "$icons/icon.iconset/"
iconutil -c icns "$icons/icon.iconset" -o "$icons/icon.icns"

i="$icons/icon.iconset"
python3 "$here/make_ico.py" "$icons/icon.ico" \
  "$i/icon_16x16.png" "$tmp/ico-24.png" "$i/icon_32x32.png" \
  "$tmp/ico-48.png" "$tmp/ico-64.png" "$i/icon_256x256.png"

echo "icons written"
