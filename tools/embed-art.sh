#!/usr/bin/env bash
# Regenerate sched/js/art-sit.js and art-all.js from the PNGs in sched/art.
# Run this after adding or replacing any character, then `node build.js`.
#
# The pages embed their characters rather than linking to them, because a
# relative path only resolves when the page is loaded with the art folder
# beside it — and when it does not, every character is a broken image with
# nothing in the console to explain it.
set -euo pipefail
cd "$(dirname "$0")/../sched/art"
python3 - <<'PY'
from PIL import Image
import base64, io, os, json
SIZE = 112                     # board draws at 76px; this covers it on a hidpi TV
sit, allm = {}, {}
# pets/ and monsters/ ship a -sit and a -walk drawing per character. chars/ is
# the newer library and has ONE pose per character, so the same image answers
# for both -- a character that does not change pose still walks, because the
# bob is a CSS animation on the sprite, not a second drawing.
# Refuse to run against a partial art tree. This script REPLACES both output
# files, so running it where only chars/ exists silently throws away every cat,
# dog and manager creature -- which happened once and was caught by key count.
for required in ('pets', 'monsters', 'chars'):
    if not os.path.isdir(required):
        raise SystemExit(f"sched/art/{required}/ is missing — refusing to regenerate "
                         "from a partial tree. Merge single additions into the js "
                         "files instead, or restore the full art folders first.")
for folder in ('pets', 'monsters', 'chars'):
    if not os.path.isdir(folder): continue
    single = folder == 'chars'
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith('.png'): continue
        im = Image.open(os.path.join(folder, fn)).convert('RGBA')
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
        stem = fn[:-4]
        uri = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        if single:
            sit[f"{folder}/{stem}-sit"] = uri
            allm[f"{folder}/{stem}-sit"] = uri
            allm[f"{folder}/{stem}-walk"] = uri
            continue
        key = f"{folder}/{stem}"
        allm[key] = uri
        if fn.endswith('-sit.png'): sit[key] = uri
HDR = ("/* Generated from sched/art by tools/embed-art.sh — do not edit by hand.\n"
       "   Every character resized to %dpx and inlined as a data URL, so the pages\n"
       "   never depend on a relative path resolving. */\n" % SIZE)
for name, data in (('art-sit.js', sit), ('art-all.js', allm)):
    with open(f'../js/{name}', 'w') as f:
        f.write(HDR + 'const ART=' + json.dumps(data, separators=(',', ':')) + ';\n')
    print(f'{name}: {len(data)} sprites')
PY
