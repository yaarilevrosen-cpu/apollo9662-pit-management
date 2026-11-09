"""
בונה את הסימולטור: קובץ אחד שנפתח בכל דפדפן, בלי שרת ובלי אינטרנט.
בתוכו מסך הפיט ושלושה טלפונים, מחוברים לאותו קוד שרת (lib/core.js) שרץ בפיט.

הנתונים בסימולטור בדויים לגמרי: מספרי קבוצה מ־90001 ומעלה, שמות ותוצאות מומצאים
(החלטה 02, כלל ב).

הרצה מתיקיית המאגר:
    python3 tools/build-sim.py
"""
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SIM = ROOT / "tools" / "sim"
OUT = ROOT / "demo" / "houston-simulator.html"


def read(p):
    return Path(p).read_text(encoding="utf-8")


# ---------- גופנים כנתונים בתוך הקובץ ----------
def font_css():
    css = read(PUBLIC / "fonts" / "fonts.css")

    def inline(m):
        data = base64.b64encode((PUBLIC / "fonts" / m.group(1)).read_bytes()).decode()
        return f"url(data:font/woff2;base64,{data})"

    return re.sub(r"url\(([\w.-]+\.woff2)\)", inline, css)


FONTS = font_css()
COMMON_CSS = re.sub(r'@import url\("fonts/fonts.css"\);\n', "", read(PUBLIC / "common.css"))
COMMON_JS = read(PUBLIC / "common.js")
QR_JS = read(PUBLIC / "vendor" / "qrcode.js")
LOGO = "data:image/svg+xml;base64," + base64.b64encode((PUBLIC / "logo.svg").read_bytes()).decode()

# לפני common.js: אחסון נפרד לכל טלפון. אחריו: הבקשות הולכות לשרת שבדף הראשי.
BRIDGE_PRE = """
window.HoustonSim = true;
window.HoustonStore = parent.Sim.store(frameElement.dataset.sim);
window.HoustonMute = parent.Sim.muted;
"""
BRIDGE_POST = """
(function () {
  var id = frameElement.dataset.sim;
  Pit.api = function (p, b) { return parent.Sim.api(id, p, b); };
  Pit.stream = function (h) { return parent.Sim.stream(id, h); };
  // בסימולטור אין חלונות אישור של הדפדפן
  window.confirm = function () { return true; };
  window.prompt = function (q, d) { return d != null ? d : '12.8'; };
})();
"""


def frame_page(name):
    html = read(PUBLIC / name)
    pairs = [
        ('<link rel="stylesheet" href="common.css">', "<style>/*__FONTS__*/\n" + COMMON_CSS + "\n</style>"),
        ('<script src="vendor/qrcode.js"></script>', "<script>\n" + QR_JS + "\n</script>"),
        ('<script src="common.js"></script>',
         "<script>" + BRIDGE_PRE + "</script>\n<script>\n" + COMMON_JS + "\n</script>\n<script>" + BRIDGE_POST + "</script>"),
        ('<link rel="manifest" href="manifest.webmanifest">\n', ""),
    ]
    for a, b in pairs:
        if a in html:
            html = html.replace(a, b)
    html = html.replace('src="logo.svg"', f'src="{LOGO}"').replace('href="logo.svg"', f'href="{LOGO}"').replace("icon: 'logo.svg'", f"icon: '{LOGO}'")
    assert "logo.svg" not in html and 'src="common.js"' not in html and 'href="common.css"' not in html, name
    return html


def js_json(x):
    # בתוך תגית סקריפט אסור שיופיע "</"
    return json.dumps(x, ensure_ascii=False).replace("</", "<\\/")


pages = {"pit": frame_page("dashboard.html"), "phone": frame_page("phone.html")}

shell = read(SIM / "simulator.html")
shell = shell.replace("/*__FONTS__*/", FONTS).replace("/*__COMMON_CSS__*/", COMMON_CSS).replace("__LOGO__", LOGO)
shell = shell.replace("/*__CORE__*/", read(ROOT / "lib" / "core.js")).replace("/*__HOST__*/", read(SIM / "sim-host.js"))
shell = shell.replace("__FONTS_JSON__", js_json(FONTS)).replace("__PAGES_JSON__", js_json(pages))

for bad in ["__FONTS_JSON__", "__PAGES_JSON__", "/*__CORE__*/", "/*__HOST__*/", "__LOGO__", "/*__COMMON_CSS__*/"]:
    assert bad not in shell, bad
# אין נתונים אמיתיים: מספרי קבוצה רק 9662 או בדויים מ־90001 ומעלה.
# בודקים את הקוד ואת הדפים, בלי הגופנים ובלי ספריית קוד הסריקה (שם יש מספרים שאינם קבוצות).
own = shell.replace(FONTS, "").replace(QR_JS, "").replace(js_json(FONTS), "").replace(js_json(QR_JS)[1:-1], "")
nums = set(re.findall(r"\b(?:1\d{4}|2\d{4}|3\d{4})\b", own))
assert not nums, f"מספרי קבוצה אמיתיים בסימולטור? {sorted(nums)[:10]}"

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(shell, encoding="utf-8")
print("built", OUT.relative_to(ROOT), f"{len(shell) // 1024}KB")
