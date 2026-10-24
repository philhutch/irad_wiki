#!/usr/bin/env node
/* Writes one static page per article, wiki/<name>.html, served by GitHub Pages
   at irad.wiki/wiki/<name>, and sitemap.xml listing them all. Run by ./build.sh
   after index.html is built: each page is index.html with the article's own
   title, description, canonical address, share card and structured data in the
   <head>, and the article text as plain HTML in <main>. Readers with JavaScript
   get the same app on top, which takes over as soon as the volumes load;
   crawlers and readers without JavaScript get the article itself.

   The text is rendered with the same parser (src/core.js) and the same
   Markdown library as the app (vendored in tools/seo/vendor). Infoboxes and
   other display templates are left out of the static text; the app draws them. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const core = require(path.join(root, 'src', 'core.js'));
const markdownit = require(path.join(__dirname, 'vendor', 'markdown-it.min.js'));

const ORIGIN = 'https://irad.wiki';
const md = markdownit({ html: true, linkify: false, typographer: false });
const texts = core.VOLUMES.map(v => fs.readFileSync(path.join(root, v.file), 'utf8'));
const wiki = core.buildWiki(texts);
const images = JSON.parse(fs.readFileSync(path.join(root, 'images', 'images.json'), 'utf8'));
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = s => encodeURIComponent(s).replace(/%2C/g, ',').replace(/%3A/g, ':');

// Last change of each volume, for <lastmod> and dateModified.
const modified = core.VOLUMES.map(v => {
  try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', v.file], { cwd: root }).toString().trim() || null; }
  catch { return null; }
});
const today = new Date().toISOString().slice(0, 10);
// Last edit of each article (written by home.js, which build.sh runs first); falls back to its volume's.
const edited = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'data', 'edited.json'), 'utf8')); } catch { return {}; } })();
const changed = a => (edited[a.slug] ? new Date(edited[a.slug] * 1000).toISOString().slice(0, 10) : modified[a.vol] || today);

// Same words as STUB_WORDS in src/app.js.
const STUB_WORDS = {
  geo: 'the geography of Irad', culture: 'Iradi culture', bio: 'an Iradi person', org: 'an Iradi organization',
  settlement: 'a settlement in Irad', plant: 'a plant of Irad', fauna: 'the animals of Irad', mountain: 'a mountain in Irad',
  craft: 'an Iradi craft', lake: 'a lake in Irad', river: 'a river in Irad', history: 'the history of Irad',
  horse: 'Iradi horses', sport: 'sport in Irad', glacier: 'a glacier in Irad',
};

function toStatic(src) {
  const pre = src
    .replace(core.WIKILINK, (_, t, label) => {
      if (core.WP_PREFIX.test(t)) {
        const name = t.replace(core.WP_PREFIX, '').trim();
        return `<a class="ext" href="${core.wpUrl(name)}" rel="noopener">${esc(label || name)}</a>`;
      }
      const target = core.resolve(wiki, t);
      const text = label || t;
      return target
        ? `<a class="wl" href="${core.pagePath(target.slug)}" title="${esc(target.title)}">${esc(text)}</a>`
        : `<a class="red" href="/#${enc(core.slugOf(t.trim()))}" rel="nofollow">${esc(text)}</a>`;
    })
    .replace(core.STUB_TEMPLATE, (_, body) => {
      const [name, ...args] = body.split('|');
      if (/^listen$/i.test(name.trim())) {
        const o = {};
        for (const raw of args) { const i = raw.indexOf('='); if (i > 0) o[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim(); }
        if (!o.file) return '';
        const file = o.file.replace(/[^\w.\-]/g, '');
        return `<div class="listen" role="group" aria-label="Audio"><div class="listen-head">Listen</div>${o.title ? `<div class="listen-title">${o.title}</div>` : ''}<audio controls preload="none" src="/audio/${file}"></audio>${o.description ? `<div class="listen-desc">${o.description}</div>` : ''}</div>`;
      }
      if (/^hatnote$/i.test(name.trim())) return `<div class="hatnote" role="note">${args.join('|')}</div>`;
      if (/^coord$/i.test(name.trim())) {
        const la = parseFloat(args[0]), lo = parseFloat(args[1]);
        return isFinite(la) && isFinite(lo) ? `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}` : '';
      }
      if (/^(main|see also|further)$/i.test(name.trim())) {
        const links = args.map(x => x.trim()).filter(Boolean).map(t => { const tg = core.resolve(wiki, t); return tg ? `<a class="wl" href="${core.pagePath(tg.slug)}">${esc(tg.title)}</a>` : esc(t); });
        const kind = name.trim().toLowerCase();
        return `<div class="hatnote" role="note">${kind === 'main' ? 'Main article' : kind === 'further' ? 'Further information' : 'See also'}: ${links.join(', ')}</div>`;
      }
      const m = name.match(/^Irad-(\w+)-stub$/i);
      if (m || /^Irad-stub$/i.test(name)) {
        const about = m ? (STUB_WORDS[m[1].toLowerCase()] || m[1].toLowerCase() + ' in Irad') : 'Irad';
        return `<div class="stub-note"><span>This article about ${esc(about)} is a stub.</span></div>`;
      }
      return '';
    });
  return md.render(pre);
}

function imageFor(a) {
  const list = images.filter(e => e.article === a.title);
  const e = list.find(x => x.placement === 'lead' || x.placement === 'infobox') || list[0];
  if (!e) return null;
  const stem = e.file.replace(/\.svg$/i, '');
  const isSvg = /\.svg$/i.test(e.file);
  const src = isSvg ? `/images/thumb/${e.width}px-${stem}.png` : `/images/${e.file}`;
  return { src, width: e.width, alt: e.alt || e.caption || '', caption: e.caption || '' };
}

function head(html, a, desc, url, img) {
  const title = `${a.title} – Irad Wiki`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc,
    url,
    inLanguage: 'en',
    articleSection: a.category,
    dateModified: changed(a),
    isPartOf: { '@type': 'WebSite', name: 'Irad Wiki', url: ORIGIN + '/' },
  };
  if (img) ld.image = ORIGIN + encodeURI(img.src);
  const set = (re, value) => { html = html.replace(re, value); };
  set(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  set(/(<meta name="description" content=")[^"]*/, `$1${esc(desc)}`);
  set(/(<link rel="canonical" href=")[^"]*/, `$1${esc(url)}`);
  set(/(<meta property="og:type" content=")[^"]*/, '$1article');
  set(/(<meta property="og:title" content=")[^"]*/, `$1${esc(title)}`);
  set(/(<meta property="og:description" content=")[^"]*/, `$1${esc(desc)}`);
  set(/(<meta property="og:url" content=")[^"]*/, `$1${esc(url)}`);
  set(/(<meta name="twitter:title" content=")[^"]*/, `$1${esc(title)}`);
  set(/(<meta name="twitter:description" content=")[^"]*/, `$1${esc(desc)}`);
  if (img) {
    const abs = ORIGIN + encodeURI(img.src);
    set(/(<meta property="og:image" content=")[^"]*/, `$1${esc(abs)}`);
    set(/(<meta name="twitter:image" content=")[^"]*/, `$1${esc(abs)}`);
    set(/(<meta property="og:image:alt" content=")[^"]*/, `$1${esc(img.alt || a.title)}`);
    set(/<meta property="og:image:width"[^>]*>\n?/, '');
    set(/<meta property="og:image:height"[^>]*>\n?/, '');
  }
  set(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2).replace(/</g, '\\u003c')}\n</script>`);
  return html;
}

function capHtml(t) {
  return esc(t).replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, tt, label) => {
    const target = core.resolve(wiki, tt), text = label || tt;
    return target ? `<a class="wl" href="${core.pagePath(target.slug)}" title="${esc(target.title)}">${text}</a>` : text;
  }).replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

function body(a, img) {
  const cat = core.categorySlug(a.category);
  const subject = core.subjectOf(a.category);
  const fig = img ? `<figure class="thumb lead" style="width:${img.width + 8}px"><img src="${esc(encodeURI(img.src))}" width="${img.width}" alt="${esc(img.alt)}">${img.caption ? `<figcaption>${capHtml(img.caption)}</figcaption>` : ''}</figure>\n` : '';
  const back = [...(wiki.backlinks.get(a.slug) || [])];
  return `<article class="static-article">
<div class="title-row"><h1 class="firstHeading">${esc(a.title)}</h1></div>
<div class="siteSub">From Irad Wiki, the free encyclopedia</div>
<div class="prose">
${fig}${toStatic(a.src)}
</div>
${back.length ? `<details class="backlinks"><summary>What links here (${back.length})</summary><ul>${back.map(b => `<li><a href="${core.pagePath(b.slug)}">${esc(b.title)}</a></li>`).join('')}</ul></details>` : ''}
<div class="catlinks">Categories: <ul><li><a href="/#Category.${cat}">${esc(a.category)}</a></li>${a.tags.map(t => `<li><a href="/#Category.${core.categorySlug(t)}">${esc(t)}</a></li>`).join('')}<li><a href="/#Subject.${core.categorySlug(subject)}">Portal: ${esc(subject)}</a></li></ul></div>
<p class="static-note"><a href="/">Main page</a> · <a href="/#Special.All">All pages</a></p>
</article>`;
}

const mainRe = /(<main id="main">)[\s\S]*?(<\/main>)/;
if (!mainRe.test(shell)) throw new Error('index.html has no <main id="main">');

const outDir = path.join(root, 'wiki');
fs.mkdirSync(outDir, { recursive: true });
const written = new Set();
const urls = [];
for (const a of wiki.articles) {
  const name = core.pageName(a.slug);
  const url = ORIGIN + core.pagePath(a.slug);
  const desc = core.lede(a.src, 160) || `${a.title}, an article in Irad Wiki, the free encyclopedia of Irad.`;
  const img = imageFor(a);
  let html = head(shell, a, desc, url, img);
  html = html.replace(mainRe, (_, open, close) => `${open}\n${body(a, img)}\n  ${close}`);
  fs.writeFileSync(path.join(outDir, name + '.html'), html);
  written.add(name + '.html');
  urls.push({ loc: url, lastmod: changed(a) });
}
// Old titles of renamed or merged articles: a small page that sends readers on to the new one.
for (const [from, to] of Object.entries(core.REDIRECTS || {})) {
  const a = core.resolve(wiki, to);
  if (!a || core.resolve(wiki, from) !== a || wiki.bySlug.has(core.slugOf(from))) continue;
  const name = core.pageName(core.slugOf(from));
  const dest = ORIGIN + core.pagePath(a.slug);
  const e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  fs.writeFileSync(path.join(outDir, name + '.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${e(from)} – Irad Wiki</title>
<meta name="robots" content="noindex"><link rel="canonical" href="${e(dest)}">
<meta http-equiv="refresh" content="0; url=${e(dest)}"></head>
<body><p>Redirected from ${e(from)} to <a href="${e(dest)}">${e(a.title)}</a>.</p></body></html>
`);
  written.add(name + '.html');
}
// Pages for articles that no longer exist.
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.html') && !written.has(f)) fs.unlinkSync(path.join(outDir, f));

const newest = urls.map(u => u.lastmod).concat(modified.filter(Boolean)).sort().pop() || today;
fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGIN}/</loc><lastmod>${newest}</lastmod></url>
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
console.log(`wiki/: ${written.size} article pages; sitemap.xml: ${urls.length + 1} addresses`);
