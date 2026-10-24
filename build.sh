#!/bin/sh
# Rebuilds the site from src/ (page.html + core.js + app.js) and the volumes.
# Run it after editing the files in src/ OR after updating the volume files.
#   1. tools/seo/static_index.js  plain-HTML outline of the wiki for index.html
#   2. (below)                    assets/wiki.css, assets/wiki.js and index.html
#   3. tools/seo/home.js          data/home.json for the main page (On this day, Recent changes)
#                                 and data/edited.json (each article's last edit)
#   4. tools/seo/pages.js         one page per article in wiki/, and sitemap.xml
set -e
cd "$(dirname "$0")"
node tools/seo/static_index.js
python3 - <<'PY'
import hashlib, html, json, os, re
page = open('src/page.html').read()
# Styles and scripts go in shared files, so the ~930 article pages stay small and the browser caches them once.
css = re.search(r'<style>\n(.*?)</style>\n', page, re.S)
js = open('src/core.js').read() + '\n' + open('src/app.js').read()
os.makedirs('assets', exist_ok=True)
open('assets/wiki.css', 'w').write(css.group(1))
open('assets/wiki.js', 'w').write(js)
v = lambda s: hashlib.sha1(s.encode()).hexdigest()[:8]
body = page.replace(css.group(0), f'<link rel="stylesheet" href="/assets/wiki.css?v={v(css.group(1))}">\n')
body = re.sub(r'<script>\n/\*CORE\*/\n</script>\n<script>\n/\*APP\*/\n</script>', f'<script src="/assets/wiki.js?v={v(js)}"></script>', body)
assert '/*APP*/' not in body and '/assets/wiki.js' in body
body = body.replace('<!--STATIC-->', open('src/static.html').read().rstrip('\n'))
desc = open('src/description.txt').read().strip()
body = body.replace('"description": "<!--DESCRIPTION-->"', '"description": ' + json.dumps(desc))
body = body.replace('<!--DESCRIPTION-->', html.escape(desc, quote=True))
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
open('index.html', 'w').write(head + body.replace('<header class="vh">', '</head>\n<body>\n<header class="vh">', 1) + '\n</body>\n</html>\n')
PY
echo "index.html rebuilt"
node tools/seo/home.js
node tools/seo/pages.js
