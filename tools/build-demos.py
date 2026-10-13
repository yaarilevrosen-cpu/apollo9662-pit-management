"""
בונה את שני קובצי ההדגמה העצמאיים (מחשב וטלפון) מתוך קוד האפליקציה.

הנתונים בהדגמה בדויים לגמרי: מספרי קבוצות, תוצאות ונתונים סטטיסטיים
נוצרים כאן באקראי עם זרע קבוע. אין בקובצי ההדגמה נתונים אמיתיים על קבוצות
(החלטה 02, כלל ב').

הרצה מתיקיית המאגר:
    python3 tools/build-demos.py
"""
import base64
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUT = ROOT / "demo"
TEAM = 9662

rng = random.Random(9662)

# ---------- אירוע בדוי ----------
others = [90101 + i for i in range(23)]
teams = [TEAM] + others


def team_stats():
    auto = round(rng.uniform(8, 40), 1)
    teleop = round(rng.uniform(25, 110), 1)
    return auto, teleop


stats = {}
for n in teams:
    auto, teleop = team_stats()
    if n == TEAM:
        auto, teleop = 21.4, 62.8
    opr = round(auto + teleop + rng.uniform(-6, 6), 1)
    stats[n] = {"auto": auto, "teleop": teleop, "opr": opr}

order = sorted(teams, key=lambda n: -(stats[n]["opr"] + rng.uniform(-15, 15)))
event_teams = []
for rank, n in enumerate(order, 1):
    wins = max(0, min(6, round(6 - rank / 4 + rng.uniform(-1, 1))))
    ties = 1 if rng.random() < 0.08 else 0
    losses = max(0, 6 - wins - ties)
    event_teams.append({
        "number": n, "rank": rank, "wins": wins, "losses": losses, "ties": ties,
        "opr": stats[n]["opr"], "auto": stats[n]["auto"], "teleop": stats[n]["teleop"],
        "avg": round(stats[n]["opr"] * 1.8 + rng.uniform(-10, 10), 1),
    })

# המשחקים שלנו: שניים שוחקו, השאר בהמשך
labels = ["מ׳3", "מ׳8", "מ׳12", "מ׳17", "מ׳21", "מ׳26", "פ׳2", "פ׳3", "פ׳5"]
aways = [None, None, 4, 8, 11, 15, 18, 19, 21]
ours = []
for i, (label, away) in enumerate(zip(labels, aways)):
    pool = rng.sample(others, 3)
    color = rng.choice(["red", "blue"])
    played = away is None
    our = their = result = None
    if played:
        our, their = (148, 131) if i == 1 else (112, 126)
        result = "W" if our > their else "L"
    ours.append({
        "key": f"m{i}", "label": label, "level": "Quals" if label.startswith("מ") else "DoubleElim",
        "color": color, "station": rng.choice([1, 2]),
        "partners": [pool[0]], "opponents": pool[1:],
        "time": None, "played": played, "our": our, "their": their, "result": result, "away": away,
    })
nxt = next(m for m in ours if not m["played"])

checklist_texts = [
    "סוללה טעונה ומחוברת",
    "רכזת הנהג טעונה ומחוברת לרובוט",
    "שלטים מחוברים ומשויכים",
    "נבחרה תוכנית אוטונומית נכונה",
    "ברגים ומחברים נבדקו",
    "סימון הברית על הרובוט",
]

base = {
    "team": TEAM, "season": 2025, "demo": False,
    "event": {"code": "DEMO", "name": "אירוע הדגמה", "start": "", "end": "", "venue": "", "city": "עיר לדוגמה", "fields": 2},
    "error": "", "updatedAt": 0, "totalMatches": 52, "playedMatches": 6,
    "ours": ours, "next": nxt, "playingNow": False, "eventTeams": event_teams,
    "checklist": [{"text": t, "done": i < 2} for i, t in enumerate(checklist_texts)],
    "batteries": [
        {"id": "b1", "name": "סוללה 1", "status": "ready", "voltage": 13.4, "uses": 3},
        {"id": "b2", "name": "סוללה 2", "status": "robot", "voltage": 12.9, "uses": 4},
        {"id": "b3", "name": "סוללה 3", "status": "charging", "voltage": None, "uses": 1},
        {"id": "b4", "name": "סוללה 4", "status": "used", "voltage": 12.1, "uses": 5},
    ],
    "repairs": [
        {"id": "r1", "text": "להחליף גלגל שמאלי קדמי", "by": "הפיט", "at": 0, "done": False},
        {"id": "r2", "text": "להדק את הברגים של הזרוע", "by": "חבר צוות", "at": 0, "done": True},
    ],
}

# ---------- מצב לטלפון ----------
phone = json.loads(json.dumps(base))
phone["me"] = {"id": "me", "name": "", "alert": {"state": "none"}}
phone["messages"] = [{"id": "m1", "from": "pit", "to": "all", "text": "כולם לחזור לפיט אחרי המשחק, יש שינוי באוטונומי", "at": 0, "readBy": []}]

# ---------- מצב למחשב ----------
laptop = json.loads(json.dumps(base))
laptop["batteries"].append({"id": "b5", "name": "סוללה 5", "status": "ready", "voltage": 13.6, "uses": 2})
laptop["members"] = [
    {"id": "u1", "name": "נועה", "online": True, "lastSeen": 0, "alert": {"state": "ack", "at": 0, "ackAt": 0}},
    {"id": "u2", "name": "עומר", "online": True, "lastSeen": 0, "alert": {"state": "none"}},
    {"id": "u3", "name": "איתי", "online": False, "lastSeen": 0, "alert": {"state": "none"}},
]
laptop["messages"] = [
    {"id": "m1", "from": "pit", "to": "all", "text": "כולם לחזור לפיט אחרי המשחק, יש שינוי באוטונומי", "at": 0, "readBy": ["u1", "u2"]},
    {"id": "m2", "from": "u1", "fromName": "נועה", "to": "pit", "text": "בדרך!", "at": 0, "readBy": []},
    {"id": "m3", "from": "u2", "fromName": "עומר", "to": "pit", "text": "השופט ביקש לראות את הרובוט בבדיקה", "at": 0, "readBy": []},
]
laptop["settings"] = {"team": TEAM, "season": None, "eventCode": "", "joinCode": "482913", "queueWarnAt": 2, "demo": False, "checklist": checklist_texts}
laptop["adminKey"] = "demo-key"
laptop["addresses"] = ["http://192.168.1.20:8765"]
count = 8000
team_info = {}
for t in event_teams:
    n = t["number"]
    s = stats[n]
    eg = round(rng.uniform(2, 14), 1)
    team_info[str(n)] = {
        "info": {"number": n, "name": "Apollo" if n == TEAM else "קבוצה לדוגמה", "city": "עיר לדוגמה", "rookieYear": rng.randint(2015, 2024)},
        "quick": {
            "tot": {"value": s["opr"] + eg, "rank": rng.randint(50, count)},
            "auto": {"value": s["auto"], "rank": rng.randint(50, count)},
            "dc": {"value": s["teleop"], "rank": rng.randint(50, count)},
            "eg": {"value": eg, "rank": rng.randint(50, count)},
            "count": count,
        },
    }
laptop["_teams"] = team_info

# ---------- אריזה לקובץ יחיד ----------
css = (PUBLIC / "common.css").read_text()
common = (PUBLIC / "common.js").read_text()
logo = "data:image/svg+xml;base64," + base64.b64encode((PUBLIC / "logo.svg").read_bytes()).decode()


def bundle(src, mock_file, state, out, extra=lambda h: h):
    html = (PUBLIC / src).read_text()
    mock = (ROOT / "tools" / mock_file).read_text().replace("__DEMO_STATE__", json.dumps(state, ensure_ascii=False))
    html = html.replace('<link rel="stylesheet" href="common.css">', "<style>\n" + css + "\n</style>")
    html = html.replace('<script src="common.js"></script>', "<script>\n" + common + "\n</script>\n<script>\n" + mock + "\n</script>")
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', "")
    html = html.replace('src="logo.svg"', f'src="{logo}"').replace('href="logo.svg"', f'href="{logo}"').replace("icon: 'logo.svg'", f"icon: '{logo}'")
    html = html.replace("<title>מרכז הפיט</title>", "<title>מרכז הפיט · הדגמה</title>")
    html = extra(html)
    assert "logo.svg" not in html and "__DEMO_STATE__" not in html
    (OUT / out).write_text(html)
    print("built", out, len(html))


def phone_extra(h):
    h = h.replace("if ('serviceWorker' in navigator && window.isSecureContext)", "if (false)")
    return h.replace("if (params.get('code')) $('#jCode').value = params.get('code');", "$('#jCode').value = params.get('code') || '482913';")


OUT.mkdir(exist_ok=True)
bundle("dashboard.html", "demo-laptop.js", laptop, "pit-center-laptop-demo.html")
bundle("phone.html", "demo-phone.js", phone, "pit-center-phone-demo.html", phone_extra)
