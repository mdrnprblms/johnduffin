"""
Parses cv_raw2.html (raw HTML of johnduffin.co.uk/cv.html, windows-1252 decoded)
into structured JSON, grouped by section (bio timeline / awards / collections /
solo exhibitions / group exhibitions / publications / TV & radio).

The page is a single <table> of <tr><td>YEAR</td><td>TEXT</td></tr> rows, with
section headers as <tr><td colspan="2"><strong>SECTION NAME</strong></td></tr>.
Some rows have an empty year cell, meaning "same year as the row above"
(used heavily in the group-exhibitions section, one row per venue/show).
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
raw = (ROOT / "cv_raw2.html").read_text(encoding="utf-8")

# Isolate the single content table (skip the small "JOHN DUFFIN RE" nav table before it)
start = raw.index('bgcolor="#CCCCCC"')
table_html = raw[start:]

row_re = re.compile(r"<tr[^>]*>\s*(.*?)\s*</tr>", re.I | re.S)
cell_re = re.compile(r"<td[^>]*>(.*?)</td>", re.I | re.S)


def clean(cell_html):
    text = re.sub(r"(?i)<br\s*/?>", " / ", cell_html)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.rstrip("/").strip()
    return text


SECTION_MAP = {
    "AWARDS": "awards",
    "COLLECTIONS": "collections",
    "SOLO EXHIBITIONS": "soloExhibitions",
    "SELECTED GROUP EXHIBITIONS": "groupExhibitions",
    "PUBLICATIONS": "publications",
    "TELEVISION AND RADIO": "televisionRadio",
}

result = {
    "bioTimeline": [],
    "awards": [],
    "collections": [],
    "soloExhibitions": [],
    "groupExhibitions": [],
    "publications": [],
    "televisionRadio": [],
}

current_section = "bioTimeline"
last_year = None

for row_m in row_re.finditer(table_html):
    row_html = row_m.group(1)
    cells = [clean(c) for c in cell_re.findall(row_html)]
    cells = [c for c in cells]

    if not cells or all(c == "" for c in cells):
        continue

    if len(cells) == 1 or (len(cells) >= 1 and cells[0] in SECTION_MAP):
        header_text = cells[0]
        if header_text in SECTION_MAP:
            current_section = SECTION_MAP[header_text]
            last_year = None
            continue
        if header_text in ("JOHN DUFFIN RE",):
            continue

    if current_section == "collections":
        # single-cell rows: institution name only
        text = cells[-1] if cells else ""
        if text:
            result["collections"].append(text)
        continue

    if len(cells) < 2:
        continue

    year, text = cells[0], cells[1]
    if not text:
        continue
    if year:
        last_year = year
    result[current_section].append({"year": last_year, "text": text})

out_path = ROOT / "output" / "info.json"
out_path.parent.mkdir(exist_ok=True)
out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

for k, v in result.items():
    print(f"{k}: {len(v)} entries")
