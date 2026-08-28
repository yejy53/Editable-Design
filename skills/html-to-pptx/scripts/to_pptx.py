#!/usr/bin/env python3
"""to_pptx —— slide / poster HTML → 可编辑 PPTX（离线、纯确定性、无服务、无 LLM）。

复用仓库现成的 ``build_editable_pptx(use_llm=False)``：自动识别画布(``.slide-canvas``
/ ``.poster-canvas`` / ``[data-canvas-width]`` / ``#poster``)、按真实宽高比定幻灯片
尺寸 → 量每个元素盒子/样式 → 四分类(text/shape/picture/image) → python-pptx 生成。
每个视觉元素(图标、箭头、插画)都是独立可拖动对象，而不是压成一张背景图。

用法：
    python3 to_pptx.py <slide-or-poster.html> [-o out.pptx] [--selector .slide-canvas]

约定：
  · 传编辑器「下载 HTML」导出的 slide.edited.html，或原始 index.html。
    **不要**传 editor.html（那里含编辑器外壳，会被一起拍进去）。
  · 相对资源(css/字体/图片)按 HTML 所在目录解析，所以在原目录里跑最稳。

依赖(与 harness 一致)：playwright(Python) + python-pptx + Pillow。
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
import tempfile
from pathlib import Path


def _locate_converter():
    """从本 Skill 自带的确定性转换核心加载 ``build_editable_pptx``。"""
    vendored = Path(__file__).resolve().with_name("_html_to_pptx.py")
    if vendored.is_file():
        spec = importlib.util.spec_from_file_location("_wca_html_to_pptx", vendored)
        if spec is None or spec.loader is None:
            raise ImportError(f"无法创建转换器加载器: {vendored}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.build_editable_pptx

    raise ModuleNotFoundError("缺少本 Skill 的 scripts/_html_to_pptx.py")


def main() -> None:
    ap = argparse.ArgumentParser(description="slide / poster HTML -> 可编辑 PPTX（离线确定性）")
    ap.add_argument("html", help="slide/poster HTML（*.edited.html 或 index.html，勿传 editor.html）")
    ap.add_argument("-o", "--out", help="输出 .pptx（默认与输入同目录同名）")
    ap.add_argument("--selector", default=None, help="画布选择器（默认自动识别）")
    args = ap.parse_args()

    src = Path(args.html).resolve()
    if not src.is_file():
        sys.stderr.write(f"找不到文件: {src}\n")
        sys.exit(2)

    out = Path(args.out).resolve() if args.out else src.with_suffix(".pptx")

    try:
        build_editable_pptx = _locate_converter()
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(
            "无法加载转换器 build_editable_pptx。\n"
            f"  原因: {exc}\n"
            "  请确认 Skill 文件完整，并安装 requirements.txt。\n"
        )
        sys.exit(1)

    work = Path(tempfile.mkdtemp(prefix="to_pptx_"))
    manifest = build_editable_pptx(
        src, work, out_name=out.name, canvas_selector=args.selector, use_llm=False
    )
    produced = Path(manifest["pptx_path"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(produced.read_bytes())
    canvas = manifest.get("canvas") or {}
    print(
        f"✅ {out}\n   画布 {canvas.get('width', 0):.0f}x{canvas.get('height', 0):.0f}"
        f" ({manifest.get('selector')}) · 形状 {manifest.get('shape_count')} · "
        f"文本框 {manifest.get('text_count')} · 独立图片 {manifest.get('picture_count')} · "
        f"元素 {manifest.get('element_count')}"
    )
    if not manifest.get("shape_count") and not manifest.get("text_count"):
        print("   ⚠️ 未重建出可编辑形状/文本（多为纯 SVG slide，整页折成背景图，仍是合法 pptx）")


if __name__ == "__main__":
    main()
