#!/usr/bin/env bash
# Rebuilds eval/synth/fonts/NotoSansTC-subset.ttf after a layout adds new CJK characters.
# pdf-lib's fontkit garbles subsets of variable TTFs and CFF OTFs, so pin a static TrueType
# instance and keep only the characters the generator prints. Needs Python with fonttools.
set -euo pipefail
PY=${PYTHON:-python}
tmp=$(mktemp -d)
curl -fsSL -o "$tmp/vf.ttf" "https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
"$PY" -m fontTools.varLib.instancer "$tmp/vf.ttf" wght=400 -o "$tmp/static.ttf" -q
grep -rhoP '[^\x00-\x7F]' eval/synth | sort -u | tr -d '\n' > "$tmp/chars.txt"
"$PY" -m fontTools.subset "$tmp/static.ttf" --text-file="$tmp/chars.txt" --unicodes="U+0020-007E" \
  --layout-features='' --no-hinting --output-file=eval/synth/fonts/NotoSansTC-subset.ttf
rm -rf "$tmp"
ls -l eval/synth/fonts/NotoSansTC-subset.ttf
