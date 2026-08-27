#!/usr/bin/env bash
# Rebuilds the published media for the Editable Visual Design post from the
# original local sources (promo project renders, tech-report figures, and the
# web-encoded editor captures). Sources are private, so the outputs are the
# only thing that lives in this repository.
set -euo pipefail

PROMO=/Users/junyanye/gc-codex/videos/editable-visual-design-promo-v3
FIG=/Users/junyanye/Desktop/GenClaw-Next/figure
WEBV=/Users/junyanye/Desktop/video_web
OUT="$(cd "$(dirname "$0")/.." && pwd)/site/public/blog/editable-design"

mkdir -p "$OUT"

v_muted() { # src dst width crf
  ffmpeg -v error -y -i "$1" -map 0:v:0 -an \
    -vf "scale=$3:-2:flags=lanczos" -c:v libx264 -preset slow -crf "$4" \
    -pix_fmt yuv420p -movflags +faststart "$OUT/$2"
}

v_sound() { # src dst width crf
  ffmpeg -v error -y -i "$1" -map 0:v:0 -map 0:a:0 \
    -vf "scale=$3:-2:flags=lanczos" -c:v libx264 -preset slow -crf "$4" \
    -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "$OUT/$2"
}

img() { # src dst width quality(2=best..31)
  ffmpeg -v error -y -i "$1" -vf "scale=$3:-2:flags=lanczos" -q:v "$4" "$OUT/$2"
}

echo "— promo"
v_sound "$PROMO/renders/v3-1080p30-123.0s-zh-bgm.mp4" promo-zh.mp4 1280 28
v_muted "$PROMO/renders/v3-1080p30-136.3s.mp4" promo-en.mp4 1280 28

echo "— editable canvas captures"
v_muted "$WEBV/北欧椅_web_2x.mp4"        editable-nordic-chair.mp4 1200 27
v_muted "$WEBV/海报编辑_0731_web_2x.mp4"  editable-poster-edit.mp4  1200 27
v_muted "$WEBV/龙年海报2_web_2x.mp4"      editable-dragon-year.mp4  1200 27
v_muted "$WEBV/钴蓝祷词_web_2x.mp4"       editable-cobalt-prayer.mp4 1200 27
v_muted "$WEBV/AI招聘海报_web_2x.mp4"     editable-ai-recruiting.mp4 1200 27
v_muted "$WEBV/山柚观音_web_2x.mp4"       editable-shanyou-tea.mp4  1200 27
v_muted "$PROMO/assets/video/nordic-editor-full.mp4" editable-canvas-wide.mp4 1728 27

echo "— design replay"
v_muted "$PROMO/assets/video/nordic-replay.mp4" replay-nordic-chair.mp4 1920 27

echo "— figures"
img "$FIG/pipeline.png"        workflow.jpg            2600 3
img "$FIG/result2.png"         showcase-editable.jpg   2230 3
img "$FIG/Agent-Replay.png"    replay-red-panda.jpg    2800 3
img "$FIG/Agent-Replay1.png"   replay-chongqing.jpg    2800 3

echo "— stills"
img "$PROMO/assets/stills/chair-diffusion.png" compare-diffusion.jpg 800 3
img "$PROMO/assets/nordic/prior.png"          prior-concept.jpg     744 3
img "$PROMO/assets/nordic/final.png"          coded-artifact.jpg    744 3
img "$PROMO/assets/nordic/exploded.png"       layers-exploded.jpg   1400 3

ls -la "$OUT"
du -sh "$OUT"
