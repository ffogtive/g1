#!/usr/bin/env bash
# 게임 파일(kungkung/real.html + real/)을 앱 안 assets/web/으로 복사한다.
# 아이폰은 mp4로 재생하므로 webm·소리 후보(cand)·시바 비교용 파일은 넣지 않는다.
set -euo pipefail
app="$(cd "$(dirname "$0")/.." && pwd)"
src="$(cd "$app/.." && pwd)"
dst="$app/assets/web"

mkdir -p "$dst/real/v3" "$dst/real/ostrich" "$dst/real/sfx"
find "$dst" -type f ! -name .gitkeep -delete

cp "$src/real.html" "$dst/"
cp "$src"/real/*.webp "$dst/real/"
for d in v3 ostrich; do
  cp "$src/real/$d"/*.mp4 "$src/real/$d"/*.jpg "$dst/real/$d/"
done
cp "$src/real/sfx/manifest.json" "$src"/real/sfx/*.mp3 "$dst/real/sfx/"

echo "assets/web: $(find "$dst" -type f ! -name .gitkeep | wc -l | tr -d ' ') files, $(du -sh "$dst" | cut -f1)"
