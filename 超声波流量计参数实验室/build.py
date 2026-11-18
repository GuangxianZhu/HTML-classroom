import subprocess, pathlib, sys
root = pathlib.Path(__file__).parent
dist = root / 'dist'; dist.mkdir(exist_ok=True)
subprocess.run(['npx', 'esbuild', 'src/main.js', '--bundle', '--minify', '--format=iife',
                '--loader:.glb=base64', '--outfile=dist/app.js', '--log-level=warning'], cwd=root, check=True)
js = (dist / 'app.js').read_text(encoding='utf-8')
assert '</script' not in js.lower(), 'script close tag inside bundle'
html = (root / 'src/template.html').read_text(encoding='utf-8').replace('/*APP*/', js)
(root / 'index.html').write_text(html, encoding='utf-8')
print('index.html', round(len(html.encode()) / 1024), 'KB')
