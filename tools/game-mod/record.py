"""Records JR's game edits as plain find-and-replace steps.

    python3 tools/game-mod/record.py <decompiled scripts> <patched scripts> src/game/mod/edits.json

patch.py is where JR's changes to the game are written. Players don't have
Python, so JR replays them on their computer from this file instead
(src/game/mod/build.js). Each step finds text that appears exactly `count`
times in the game's decompiled script and replaces it; the file keeps only
JR's code and the short lines of the game it attaches to.

Run it after changing patch.py, anchors.py or as/JRUI.as (build.sh record
does both steps), and commit the new edits.json.
"""
import difflib
import hashlib
import json
import os
import sys

FFDEC = '26.4.0'


def classes():
    here = os.path.dirname(os.path.abspath(__file__))
    for line in open(os.path.join(here, 'build.sh'), encoding='utf-8'):
        if line.startswith('classes='):
            return line.strip().split('=', 1)[1].split(',')
    sys.exit('build.sh: no classes= line')


def steps_for(old, new):
    """Find-and-replace steps that turn old into new, each found by unique text."""
    a = old.splitlines(keepends=True)
    b = new.splitlines(keepends=True)
    for context in (2, 4, 8, 16, 40):
        steps = []
        ok = True
        for group in difflib.SequenceMatcher(None, a, b, autojunk=False).get_grouped_opcodes(context):
            i1, i2 = group[0][1], group[-1][2]
            j1, j2 = group[0][3], group[-1][4]
            find = ''.join(a[i1:i2])
            if not find or old.count(find) != 1:
                ok = False
                break
            steps.append({'find': find, 'replace': ''.join(b[j1:j2]), 'count': 1})
        if ok and apply(old, steps) == new:
            return steps
    sys.exit('Could not record the edits uniquely; widen the context')


def apply(text, steps):
    for s in steps:
        if text.count(s['find']) != s['count']:
            return None
        text = text.replace(s['find'], s['replace'])
    return text


def main(src, mod, out):
    files = {}
    for root, _, names in os.walk(mod):
        for name in sorted(names):
            path = os.path.join(root, name)
            rel = os.path.relpath(path, mod).replace(os.sep, '/')
            old = open(os.path.join(src, rel), encoding='utf-8').read().replace('\r\n', '\n')
            new = open(path, encoding='utf-8').read().replace('\r\n', '\n')
            files[rel] = steps_for(old, new)
    body = {'ffdec': FFDEC, 'classes': classes(), 'files': dict(sorted(files.items()))}
    text = json.dumps(body, indent=1, ensure_ascii=False)
    body['id'] = hashlib.sha1(text.encode('utf-8')).hexdigest()[:10]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(body, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'Recorded {sum(len(v) for v in files.values())} edits in {len(files)} files ({body["id"]}) to {out}')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
