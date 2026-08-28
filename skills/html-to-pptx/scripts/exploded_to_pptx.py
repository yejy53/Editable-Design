#!/usr/bin/env python3
"""exploded_to_pptx —— case 的 layers.html（图层展开图）→ 一页可编辑 PPTX。

一页幻灯片复刻整张展开图的排布，**去掉 Full overview 那一项**，其余每块（各图层／
分组／背景底）里的元素都重建成独立可拖对象。

用法：
    python3 exploded_to_pptx.py <layers.html> [-o out.pptx] [--keep-overview]

通常不必直接调它 —— ``to_pptx.py`` 会自动认出展开图并转到这里。

页面自身的三个特性会干扰通用转换器，这里在量画布之前一次性抹平：
  1. board 会按窗口大小自适应缩放，而转换器又要把视口调成画布大小 —— 两者互相触发，
     越缩越小。用 !important 规则钉死 transform，压过页面脚本写的 inline style。
  2. 入场动画期间各块带临时 transform，等 data-hf-exploded-ready 再落位。
  3. overview 缩略图、扫描光效、replay 按钮属于页面外壳，不是内容。

依赖：playwright(Python) + python-pptx + Pillow。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

BOARD = ".hf-exploded-board"
READY = "[data-hf-exploded-ready='1']"

# 在页面里跑：抹平自适应缩放、落位、清外壳。
PREPARE_JS = r"""
(opts) => {
  const board = document.querySelector('.hf-exploded-board');
  if (!board) return null;

  // 动画收尾：脚本正常会加这两个 class，这里兜底，避免半路截图
  board.classList.remove('hf-exploded-animating');
  board.classList.add('hf-exploded-settled');
  for (const a of (document.getAnimations ? document.getAnimations() : [])) {
    try { a.finish(); } catch (e) { try { a.cancel(); } catch (e2) {} }
  }
  for (const it of board.querySelectorAll('.hf-exploded-item')) {
    it.style.removeProperty('transform');
    it.style.removeProperty('opacity');
  }

  // 页面外壳：overview 缩略图、扫描光效、replay 按钮
  if (!opts.keepOverview) {
    board.querySelectorAll('[data-exploded-overview]').forEach((n) => n.remove());
  }
  board.querySelectorAll('.hf-exploded-scan').forEach((n) => n.remove());
  document.querySelectorAll('.hf-exploded-replay').forEach((n) => n.remove());

  const w = parseFloat(board.dataset.width) || board.getBoundingClientRect().width;
  const h = parseFloat(board.dataset.height) || board.getBoundingClientRect().height;

  // !important 压过页面 resize() 写的 inline transform（作者 !important 在层叠里
  // 高于 animation，也高于普通 inline），从此 board 恒为 1:1 且贴在原点。
  const css = document.createElement('style');
  css.textContent = `
    html,body{margin:0!important;padding:0!important;display:block!important;
      min-height:0!important;background:transparent!important}
    .hf-exploded-shell{position:static!important;width:${w}px!important;height:${h}px!important;
      transform:none!important;margin:0!important}
    .hf-exploded-board{position:absolute!important;left:0!important;top:0!important;
      transform:none!important;width:${w}px!important;height:${h}px!important}
    .hf-exploded-item{filter:none!important}`;
  document.head.appendChild(css);
  return { width: Math.round(w), height: Math.round(h) };
}
"""

# 只读 board 尺寸和分块清单，不改页面。
PROBE_JS = r"""
() => {
  const board = document.querySelector('.hf-exploded-board');
  if (!board) return null;
  const items = [...board.querySelectorAll('.hf-exploded-item')].map((el) => ({
    name: el.dataset.layerName || '',
    unit: el.dataset.explodedUnit || '',
    overview: !!el.dataset.explodedOverview,
    title: el.getAttribute('title') || '',
  }));
  return {
    width: parseFloat(board.dataset.width) || 0,
    height: parseFloat(board.dataset.height) || 0,
    items,
  };
}
"""


def locate_converter():
    """Load the deterministic conversion core vendored with this Skill."""
    vendored = Path(__file__).resolve().with_name("_html_to_pptx.py")
    if vendored.is_file():
        spec = importlib.util.spec_from_file_location("_wca_html_to_pptx", vendored)
        if spec is None or spec.loader is None:
            raise ImportError(f"无法创建转换器加载器: {vendored}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    raise ModuleNotFoundError("缺少本 Skill 的 scripts/_html_to_pptx.py")


# 老名字，外部可能还在用
_locate_converter = locate_converter


def _browser_args() -> list[str]:
    """Keep Chromium sandboxing on unless the host explicitly opts out."""
    return ["--no-sandbox"] if os.environ.get("HTML_TO_PPTX_NO_SANDBOX") == "1" else []


def probe(src: Path) -> dict:
    """先量一遍 board：拿自然尺寸定视口，顺便报告分块构成。"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=_browser_args())
        try:
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.goto(src.resolve().as_uri(), wait_until="load", timeout=30000)
            try:
                page.wait_for_selector(READY, timeout=30000)
            except Exception:  # noqa: BLE001
                pass
            return page.evaluate(PROBE_JS)
        finally:
            browser.close()


_probe = probe


def convert(src: Path, out: Path, *, keep_overview: bool = False, quiet: bool = False) -> dict:
    """layers.html → 一页 pptx。返回 build_editable_pptx 的 manifest。"""
    converter = locate_converter()
    info = probe(src)
    if not info:
        raise RuntimeError(f"页面里没有 {BOARD}，这不是一张图层展开图")

    kept = [i for i in info["items"] if keep_overview or not i["overview"]]
    if not quiet:
        units: dict[str, int] = {}
        for item in kept:
            units[item["unit"]] = units.get(item["unit"], 0) + 1
        print(
            f"board {info['width']:.0f}x{info['height']:.0f} · 分块 {len(kept)} "
            f"（跳过 overview {len(info['items']) - len(kept)}）· {units}"
        )

    prepare = f"() => ({PREPARE_JS})({json.dumps({'keepOverview': keep_overview})})"
    work = Path(tempfile.mkdtemp(prefix="exploded_pptx_"))
    manifest = converter.build_editable_pptx(
        src,
        work,
        out_name=out.name,
        canvas_selector=BOARD,
        use_llm=False,
        ready_selector=READY,
        prepare_js=prepare,
        viewport=(int(info["width"]), int(info["height"])),
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(Path(manifest["pptx_path"]).read_bytes())
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description="layers.html 图层展开图 -> 一页可编辑 PPTX")
    ap.add_argument("html", help="case 的 layers.html")
    ap.add_argument("-o", "--out", help="输出 .pptx（默认与输入同目录 layers.pptx）")
    ap.add_argument("--keep-overview", action="store_true", help="保留 Full overview 缩略图")
    args = ap.parse_args()

    src = Path(args.html).resolve()
    if not src.is_file():
        sys.stderr.write(f"找不到文件: {src}\n")
        sys.exit(2)
    out = Path(args.out).resolve() if args.out else src.with_suffix(".pptx")

    try:
        manifest = convert(src, out, keep_overview=args.keep_overview)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"{exc}\n")
        sys.exit(2)

    print(
        f"✅ {out}\n   形状 {manifest['shape_count']} · 文本框 {manifest['text_count']} · "
        f"独立图片 {manifest['picture_count']} · 元素 {manifest['element_count']}"
    )


if __name__ == "__main__":
    main()
