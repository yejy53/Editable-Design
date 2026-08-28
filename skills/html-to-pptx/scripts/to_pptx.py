#!/usr/bin/env python3
"""to_pptx —— slide / poster HTML → 可编辑 PPTX（离线、纯确定性、无服务、无 LLM）。

一个入口吃三种页面，自己认，不用你分：

  · 普通 slide / poster（``index.html``、编辑器导出的 ``*.edited.html``）
  · 编辑器页面 ``editor.html`` —— 海报外面套着工具栏／图层面板／缩放舞台
  · 图层展开图 ``layers.html`` —— 一块板上摊开各图层，还带 overview 和入场动画

三条路最终都调同一个 ``build_editable_pptx(use_llm=False)``：识别画布 → 按真实宽高比
定幻灯片尺寸 → 量每个元素的盒子和样式 → 四分类(text/shape/picture/image) → 生成 pptx。
每个视觉元素（图标、箭头、插画）都是独立可拖对象，而不是压成一张背景图。

差别只在**量画布之前怎么把页面弄成可测量的状态**，转换器为此留了
``prepare_js`` / ``ready_selector`` / ``viewport`` 三个钩子：

  · 普通页面：什么都不用做。
  · editor.html：调编辑器自己暴露的 ``fullHTML()``（即「Download HTML」按钮的输出）
    拿到剥掉外壳的干净 HTML。用它的官方导出路径，就不会和编辑器实现漂移。
  · layers.html：转给 ``exploded_to_pptx``，那里有等动画落位、去 overview、
    关响应式缩放的整套预处理。

用法：
    python3 to_pptx.py <html> [-o out.pptx] [--selector .slide-canvas]
                              [--mode auto|plain|editor|exploded] [--keep-overview]

相对资源(css/字体/图片)按 HTML 所在目录解析，所以在原目录里跑最稳。

依赖：playwright(Python) + python-pptx + Pillow + numpy。
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

EDITOR_READY = "html[data-hf-ready='1']"

# 三种页面的判别信号都很硬，不靠猜：编辑器会把 API 挂到 window 上，展开图有 board 容器。
CLASSIFY_JS = """() => {
  const api = window.__layerEditor || window.__freeEditor || null;
  return {
    editor: !!(api && typeof api.fullHTML === 'function'),
    editorChrome: !!(document.querySelector('.hf-stage-wrap') && document.querySelector('.hf-bar')),
    exploded: !!document.querySelector('.hf-exploded-board'),
  };
}"""

SETTLED_JS = """() => !!(window.__layerEditor || window.__freeEditor)
  || !!document.querySelector('.hf-exploded-board')"""

GRAB_HTML_JS = """() => {
  const api = window.__layerEditor || window.__freeEditor;
  return (api && typeof api.fullHTML === 'function') ? api.fullHTML() : null;
}"""


def _browser_args() -> list[str]:
    """Keep Chromium sandboxing on unless the host explicitly opts out."""
    return ["--no-sandbox"] if os.environ.get("HTML_TO_PPTX_NO_SANDBOX") == "1" else []


def _exploded_module():
    """同目录的 exploded_to_pptx，用文件路径加载，免得依赖包结构。"""
    import importlib.util

    path = Path(__file__).resolve().parent / "exploded_to_pptx.py"
    spec = importlib.util.spec_from_file_location("_wca_exploded", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法创建展开图转换器加载器: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _locate_converter():
    """Load the deterministic conversion core bundled with this Skill."""
    return _exploded_module().locate_converter()


def classify(src: Path) -> str:
    """开一次页面，认出它是 plain / editor / exploded。"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=_browser_args())
        try:
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.goto(src.as_uri(), wait_until="load", timeout=30000)
            # 编辑器和展开图都在 load 之后才装配，给它们一点时间；普通页面会等满后放行
            try:
                page.wait_for_function(SETTLED_JS, timeout=5000)
            except Exception:  # noqa: BLE001
                pass
            flags = page.evaluate(CLASSIFY_JS)
        finally:
            browser.close()

    if flags["editor"]:
        return "editor"
    if flags["exploded"]:
        return "exploded"
    if flags["editorChrome"]:
        # 有外壳却没 API：多半是编辑器脚本没跑起来，硬转会把工具栏拍进去
        raise RuntimeError(
            "看着像 editor.html，但页面没有暴露 __layerEditor/__freeEditor.fullHTML，"
            "无法安全地剥掉编辑器外壳。请改传 index.html 或编辑器导出的 *.edited.html。"
        )
    return "plain"


def editor_clean_html(src: Path) -> str:
    """调编辑器自己的 fullHTML()，拿它「Download HTML」会给出的那份 HTML。"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=_browser_args())
        try:
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.goto(src.as_uri(), wait_until="load", timeout=30000)
            # <html> 永远不算 "visible"，只能等它挂上
            page.wait_for_selector(EDITOR_READY, state="attached", timeout=30000)
            page.wait_for_timeout(300)
            html = page.evaluate(GRAB_HTML_JS)
        finally:
            browser.close()
    if not html:
        raise RuntimeError("编辑器没有返回 fullHTML()")
    return html


def _report(out: Path, manifest: dict) -> None:
    canvas = manifest.get("canvas") or {}
    print(
        f"✅ {out}\n   画布 {canvas.get('width', 0):.0f}x{canvas.get('height', 0):.0f}"
        f" ({manifest.get('selector')}) · 形状 {manifest.get('shape_count')} · "
        f"文本框 {manifest.get('text_count')} · 独立图片 {manifest.get('picture_count')} · "
        f"元素 {manifest.get('element_count')}"
    )
    if not manifest.get("shape_count") and not manifest.get("text_count"):
        print("   ⚠️ 未重建出可编辑形状/文本（多为纯 SVG slide，整页折成背景图，仍是合法 pptx）")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="slide / poster / editor / 图层展开图 HTML -> 可编辑 PPTX（离线确定性）"
    )
    ap.add_argument("html", help="index.html / *.edited.html / editor.html / layers.html")
    ap.add_argument("-o", "--out", help="输出 .pptx（默认与输入同目录同名）")
    ap.add_argument("--selector", default=None, help="画布选择器（默认自动识别）")
    ap.add_argument(
        "--mode",
        default="auto",
        choices=["auto", "plain", "editor", "exploded"],
        help="页面类型，默认自动识别",
    )
    ap.add_argument("--keep-overview", action="store_true",
                    help="展开图专用：保留 Full overview 缩略图")
    args = ap.parse_args()

    src = Path(args.html).resolve()
    if not src.is_file():
        sys.stderr.write(f"找不到文件: {src}\n")
        sys.exit(2)
    out = Path(args.out).resolve() if args.out else src.with_suffix(".pptx")

    try:
        mode = args.mode if args.mode != "auto" else classify(src)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"{exc}\n")
        sys.exit(2)
    print(f"页面类型：{mode}" + ("（自动识别）" if args.mode == "auto" else "（手动指定）"))

    if mode == "exploded":
        try:
            manifest = _exploded_module().convert(
                src, out, keep_overview=args.keep_overview
            )
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"{exc}\n")
            sys.exit(2)
        _report(out, manifest)
        return

    try:
        converter = _locate_converter()
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(
            "无法加载转换器 build_editable_pptx。\n"
            f"  原因: {exc}\n"
            "  请在仓库环境(含 playwright / python-pptx / Pillow)里运行。\n"
        )
        sys.exit(1)

    staged: Path | None = None
    source = src
    if mode == "editor":
        try:
            html = editor_clean_html(src)
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"无法从编辑器导出干净 HTML: {exc}\n")
            sys.exit(2)
        # 必须和 editor.html 同目录，否则 assets/ 里的字体和图片解析不到
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=src.parent,
            prefix=f".{src.stem}.wca-export-",
            suffix=".html",
            delete=False,
        ) as handle:
            handle.write(html)
            staged = Path(handle.name)
        source = staged
        print(f"   编辑器 fullHTML() 导出 {len(html) / 1024:.0f} KB，已剥掉编辑器外壳")

    try:
        work = Path(tempfile.mkdtemp(prefix="to_pptx_"))
        manifest = converter.build_editable_pptx(
            source, work, out_name=out.name,
            canvas_selector=args.selector, use_llm=False,
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(Path(manifest["pptx_path"]).read_bytes())
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)

    _report(out, manifest)


if __name__ == "__main__":
    main()
