import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2] || path.join(repo, 'out/readme-preview'));
await fs.mkdir(output, { recursive: true });
for (const [name, source] of [['assets', 'assets'], ['gallery', 'gallery'], ['charts', 'site/public/blog/genclaw-next/charts']]) {
  try { await fs.symlink(path.join(repo, source), path.join(output, name)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{Letter}\p{Number}\s_-]/gu, '').replace(/ /g, '-');
const parser = new Marked({ renderer: { heading({tokens, depth, text}) {
  return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>`;
}} });
const css = `*{box-sizing:border-box}body{margin:0;color:#1f2328;background:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} .notice{padding:12px 24px;background:#f6f8fa;border-bottom:1px solid #d1d9e0;font-size:13px;color:#59636e}.notice a{margin-right:16px}.markdown-body{max-width:1012px;margin:24px auto 80px;padding:32px;border:1px solid #d1d9e0;border-radius:6px}a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}h1,h2,h3{line-height:1.25;font-weight:600;margin:24px 0 16px}h1{font-size:32px;margin-top:0;padding-bottom:.3em;border-bottom:1px solid #d1d9e0}h2{font-size:24px;padding-bottom:.3em;border-bottom:1px solid #d1d9e0}h3{font-size:20px}p,ul,ol,blockquote,pre,table{margin:0 0 16px}li+li{margin-top:4px}img,video{max-width:100%;height:auto}blockquote{padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}pre{padding:16px;overflow:auto;background:#f6f8fa;border-radius:6px;font-size:13px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#eff1f3;border-radius:4px}pre code{background:none}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d9e0;padding:6px 13px}summary{cursor:pointer;margin-bottom:16px} @media(max-width:767px){.markdown-body{margin:0;border:0;padding:20px}h1{font-size:28px}h2{font-size:22px}}`;
for (const [source, target] of [['README.md', 'index.html'], ['docs/paper-fig.md', 'paper-fig.html']]) {
  let html = parser.parse(await fs.readFile(path.join(repo, source), 'utf8'));
  html = html.replace(/(href|src)="([^"]+)"/g, (_, attr, value) => {
    if (value.startsWith('https://yejy53.github.io/Editable-Design/')) {
      value = value.replace('https://yejy53.github.io', '');
    } else if (value.startsWith('.')) {
      const [file, hash] = value.split('#');
      let relative = path.relative(repo, path.resolve(repo, path.dirname(source), file));
      if (relative === 'README.md') relative = 'index.html';
      else if (relative === 'docs/paper-fig.md') relative = 'paper-fig.html';
      else if (relative.startsWith('site/public/blog/genclaw-next/charts/')) relative = relative.replace('site/public/blog/genclaw-next/charts/', 'charts/');
      else if (!relative.startsWith('assets/') && !relative.startsWith('gallery/')) relative = `https://github.com/yejy53/Editable-Design/tree/main/${relative}`;
      value = relative + (hash ? `#${hash}` : '');
    }
    return `${attr}="${value}"`;
  }).replace(/<img /g, '<img loading="lazy" ').replace(/<video /g, '<video preload="none" ');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${source} — Local preview</title><style>${css}</style></head><body><nav class="notice"><a href="index.html">README 预览</a><a href="paper-fig.html">Paper Fig 独立页</a><a href="/Editable-Design/zh/blog/genclaw-next/">中文 Blog</a><a href="/Editable-Design/en/blog/genclaw-next/">English Blog</a><span>本地草稿 · GitHub 风格近似预览 · 尚未发布</span></nav><article class="markdown-body">${html}</article></body></html>`;
  await fs.writeFile(path.join(output, target), page);
}
console.log(`README and Paper Fig previews: ${output}`);
