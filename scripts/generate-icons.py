"""Development-only compatibility entry point for the SVG icon exporter.
Requires Node.js, Playwright and Edge; use NODE_PATH/ICON_BROWSER as needed.
No build dependency is required to run the website.
"""
from pathlib import Path
import os
import shutil
import subprocess

node = os.environ.get('ICON_NODE') or shutil.which('node')
if not node:
    raise SystemExit('Node.js is required; set ICON_NODE to the executable path.')
subprocess.run([node, str(Path(__file__).with_suffix('.cjs'))], check=True)
