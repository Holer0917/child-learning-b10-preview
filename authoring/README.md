# Entry/profile source

Edit `main.js` and `profiles.js` here, then regenerate the corresponding runtime modules:

```sh
python -m pip install rjsmin==1.2.4
python scripts/build-entry.py
python scripts/build-entry.py --check
```

Only comments and whitespace are compressed. The website uses the checked-in runtime files and requires no build service or third-party browser dependency. This keeps the original 300000-byte resource target while adding explicit profile selection. Other runtime modules keep their existing source paths.
