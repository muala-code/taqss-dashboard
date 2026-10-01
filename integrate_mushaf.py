#!/usr/bin/env python3
"""Safely integrate the mushaf into the CURRENT taqss-dashboard working tree.
Run: python integrate_mushaf.py "E:\taqss-dashboard"
Never overwrites app.js, radar.js, config.js, markets-config.js or existing Quran data/fonts.
"""
from pathlib import Path
import sys, re, shutil, subprocess
src=Path(__file__).resolve().parent
if len(sys.argv)!=2: raise SystemExit('Usage: python integrate_mushaf.py E:\\taqss-dashboard')
root=Path(sys.argv[1]).resolve()
index=root/'index.html';css=root/'styles.css'
if not index.is_file() or not css.is_file() or not (root/'app.js').is_file():
    raise SystemExit('Expected current index.html, styles.css and app.js; no files changed.')
html=index.read_text(encoding='utf-8-sig');style=css.read_text(encoding='utf-8-sig')
if 'data-tab="mushaf"' in html or 'id="panel-mushaf"' in html:
    raise SystemExit('Mushaf already integrated in this folder. Stop; do not overwrite unreviewed changes.')
if 'class="tabs"' not in html or '</main>' not in html:
    raise SystemExit('Unexpected HTML layout; no files changed.')
if not (root/'mushaf-data'/'kfgqpc_hafs_v30.json').is_file():
    raise SystemExit('Missing official Quran JSON in mushaf-data; no files changed.')
if not (root/'mushaf-fonts').is_dir():
    raise SystemExit('Missing mushaf-fonts folder; no files changed.')
# Insert tab inside existing main tab bar, just before the closing nav.
m=re.search(r'<nav\b[^>]*class=["\'][^"\']*\btabs\b[^"\']*["\'][^>]*>.*?</nav>',html,re.S)
if not m: raise SystemExit('Cannot identify tabs nav; no files changed.')
newnav=m.group().replace('</nav>','    <button class="tab" data-tab="mushaf">📖 المصحف</button>\n  </nav>')
newhtml=html[:m.start()]+newnav+html[m.end():]
panel=(src/'mushaf-panel.html').read_text(encoding='utf-8')
newhtml=newhtml.replace('</main>',panel+'\n  </main>',1)
if re.search(r'<script[^>]+src=["\']mushaf.js',newhtml):
    raise SystemExit('Existing mushaf script found; no files changed.')
newhtml=newhtml.replace('</body>', '  <script src="mushaf.js?v=0.22.8"></script>\n</body>',1)
# Keep original styles.css verbatim: load separate stylesheet after it.
newhtml=newhtml.replace('</head>','  <link rel="stylesheet" href="mushaf.css?v=0.22.8">\n</head>',1)
# Commit no implicit git operations; a backup of only touched files for recovery.
backup=root.parent/(root.name+'-mushaf-backup-files');backup.mkdir(exist_ok=True)
shutil.copy2(index,backup/'index.html');shutil.copy2(css,backup/'styles.css')
index.write_text(newhtml,encoding='utf-8')
shutil.copy2(src/'mushaf.js',root/'mushaf.js')
shutil.copy2(src/'mushaf.css',root/'mushaf.css')
print('Integrated. Current app.js/config.js/radar.js and data/fonts untouched.')
print('Check git diff and run local smoke test before git add/commit/push.')
