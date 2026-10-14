#!/usr/bin/env bash
# 게임 파일(kungkung/real.html + real/)을 앱 안 assets/web/으로 복사한다.
# 아이폰은 mp4로 재생하므로 webm·소리 후보(cand)·시바 비교용 파일과 real.html이 부르지 않는 클립은 넣지 않는다.
set -euo pipefail
app="$(cd "$(dirname "$0")/.." && pwd)"
src="$(cd "$app/.." && pwd)"
dst="$app/assets/web"

mkdir -p "$dst/real/v3" "$dst/real/ostrich" "$dst/real/sfx"
find "$dst" -type f ! -name .gitkeep -delete

cp "$src/real.html" "$dst/"
cp "$src"/real/*.webp "$dst/real/"
for d in v3 ostrich; do
  cp "$src/real/$d"/*.jpg "$dst/real/$d/"
  for f in "$src/real/$d"/*.mp4; do   # real.html이 실제로 부르는 클립만 (예: 타조 back_l_rev는 안 씀)
    stem="$d/$(basename "$f" .mp4)"
    if grep -qF "'$stem'" "$src/real.html"; then cp "$f" "$dst/real/$d/"; fi
  done
done
cp "$src/real/sfx/manifest.json" "$src"/real/sfx/*.mp3 "$dst/real/sfx/"

echo "assets/web: $(find "$dst" -type f ! -name .gitkeep | wc -l | tr -d ' ') files, $(du -sh "$dst" | cut -f1)"
