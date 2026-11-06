"""
生成单文件离线版：site/ 里的网页 + 图片 + 3D 模型 + three.js 全部塞进一个 HTML。
双击就能打开（不需要服务器、不需要联网）。
用法：python build_offline.py      （改了 site/ 里的东西后重新跑一次）
需要：Python 3.8+，可选 Pillow（有的话图片转 WebP 更小）
"""
import base64, json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")
OUT = os.path.join(ROOT, "index.html")
MODELS = ["absorb", "refract", "toroid", "ultra", "density", "titration", "ozone", "membrane", "resist"]

def read(p, mode="r"):
    with open(os.path.join(SITE, p), mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f:
        return f.read()

def img_uri(name):
    path = os.path.join(SITE, "img", name + ".png")
    try:
        from PIL import Image
        import io
        im = Image.open(path)
        im.thumbnail((1000, 1000))
        buf = io.BytesIO(); im.save(buf, "WEBP", quality=82)
        return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        with open(path, "rb") as f:
            return "data:image/png;base64," + base64.b64encode(f.read()).decode()

def safe(js):  # 防止内联脚本里出现 </script>
    return js.replace("</script", "<\\/script")

html = read("index.html")
css = read("style.css")
html = re.sub(r"<!--STYLE-->.*?<!--/STYLE-->", lambda m: f"<style>\n{css}\n</style>", html, flags=re.S)

imgs = {n: img_uri(n) for n in MODELS}
# 静态 <img>（不靠脚本也能显示，比如 iPhone「文件」App 的预览）也换成内嵌图片
for n in MODELS:
    html = html.replace(f'src="img/{n}.png"', f'src="{imgs[n]}"')
glbs = {n: base64.b64encode(read(f"models/{n}.glb", "rb")).decode() for n in MODELS}
data = f"window.__OFFLINE=true;\nwindow.__GLB={json.dumps(glbs)};"
scripts = "\n".join(f"<script>\n{safe(s)}\n</script>" for s in [
    data, read("patents.js"), read("exp.js"), read("app.js"), read("lib/viewer.bundle.js")])
html = re.sub(r"<!--SCRIPTS-->.*?<!--/SCRIPTS-->", lambda m: scripts, html, flags=re.S)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print(f"已生成 {OUT}  ({os.path.getsize(OUT) / 1e6:.1f} MB)")
