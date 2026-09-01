#!/usr/bin/env bash
# 把 skill 打包成可分发的压缩包（按输出扩展名选 .zip 或 .tar.gz）
#
#   ./pack.sh                              默认 ~/Desktop/html-to-pptx-skill.tar.gz
#   ./pack.sh ~/Desktop/xxx.zip            后缀写 .zip 就出 zip
#
# 完整复制当前 Skill；转换核心已经固定在 scripts/_html_to_pptx.py。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="html-to-pptx"
OUT="${1:-$HOME/Desktop/${NAME}-skill.tar.gz}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
if [ ! -f "$HERE/scripts/_html_to_pptx.py" ]; then
  echo "❌ 缺少 scripts/_html_to_pptx.py，已中止。" >&2
  exit 1
fi
cp -R "$HERE" "$STAGE/$NAME"
find "$STAGE/$NAME" -name '.DS_Store' -delete
find "$STAGE/$NAME" -name '._*' -delete
find "$STAGE/$NAME" -type d \( -name '__pycache__' -o -name '.venv' \) -prune -exec rm -rf {} +

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
if [[ "$OUT" == *.zip ]]; then
  # -X 不写 macOS 的资源分支，免得对方解出一堆 __MACOSX/._ 垃圾文件
  ( cd "$STAGE" && zip -q -r -X "$OUT" "$NAME" -x '*.DS_Store' )
  COUNT=$(unzip -Z1 "$OUT" | grep -vc '/$')
  UNPACK="unzip $(basename "$OUT") -d ~/.codex/skills/"
else
  tar -czf "$OUT" -C "$STAGE" "$NAME"
  COUNT=$(tar -tzf "$OUT" | grep -vc '/$')
  UNPACK="tar -xzf $(basename "$OUT") -C ~/.codex/skills/"
fi

echo ""
echo "✅ 已打包 $OUT"
echo "   体积 $(du -h "$OUT" | cut -f1)　文件 $COUNT 个"
echo ""
echo "对方使用方式："
echo "  $UNPACK"
echo "  首次转换直接运行：bash ~/.codex/skills/$NAME/scripts/run.sh <input.html>"
echo "  Skill 会自动创建隔离环境并安装所需依赖。"
echo ""
echo "系统需要可用的 Python 3.10+；Codex Desktop 自带的兼容运行时会被自动发现。"
echo "跑 render_check.py 还需 LibreOffice 与 PyMuPDF。"
