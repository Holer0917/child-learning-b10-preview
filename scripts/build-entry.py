"""Generate entry/profile runtime modules from readable source; rjsmin==1.2.4."""
from pathlib import Path
import sys
import rjsmin

root = Path(__file__).resolve().parent.parent
assert rjsmin.__version__ == '1.2.4', 'Install rjsmin==1.2.4'
for source, target in [('main.js', 'src/main.js'), ('profiles.js', 'src/ui/pages/profiles.js')]:
    code = '// Generated from authoring/' + source + '; run python scripts/build-entry.py.\n'
    code += rjsmin.jsmin((root / 'authoring' / source).read_text(encoding='utf-8')) + '\n'
    if '--check' in sys.argv:
        assert (root / target).read_text(encoding='utf-8') == code, target
    else:
        (root / target).write_text(code, encoding='utf-8', newline='\n')
print('Entry/profile source and runtime modules match')
