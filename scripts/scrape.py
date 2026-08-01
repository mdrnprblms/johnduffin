"""
Scraper for johnduffin.co.uk artwork catalogue.

Site structure (Adobe Photoshop "Web Photo Gallery" export, one per sub-collection):
  nav.html
    -> oils.html / prints.html / pastels.html / watercol.html / drawings.html   (category pages)
         -> <gallery>/index.html   (one per year/series, linked via MM_openBrWindow popup calls)
              -> pages/<item>.html   (one per artwork)
                   -> ../images/<item>.jpg   (full size image)

Each item detail page has a freeform text header like:
  JOHN DUFFIN - DRAWINGS - 1992-97
  Accusing Searcher Ink1996
  56 x 38 cm  Unframed: £495
optionally followed by a red "SOLD" <FONT> tag.

This script crawls the whole tree, downloads every full-size image, and writes
a structured dataset (JSON + CSV) with title/medium/year/dimensions/price/sold
status alongside the raw text (kept verbatim since formatting is inconsistent
across 25+ years of hand-edited pages).
"""
import csv
import html
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import requests

BASE = "http://www.johnduffin.co.uk"
CATEGORY_PAGES = {
    "oils": "oils.html",
    "prints": "prints.html",
    "pastels": "pastels.html",
    "watercolours": "watercol.html",
    "drawings": "drawings.html",
}

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "output"
IMG_DIR = OUT_DIR / "images"
LOG_PATH = OUT_DIR / "log.txt"
CHECKPOINT_PATH = OUT_DIR / "data.partial.json"
JSON_PATH = OUT_DIR / "data.json"
CSV_PATH = OUT_DIR / "data.csv"

WORKERS = 6
TIMEOUT = 25
RETRIES = 3

session = requests.Session()
session.headers.update({"User-Agent": "JohnDuffinArchiveScraper/1.0 (personal catalogue backup)"})

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, mode="w", encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("scrape")


def fetch(url, binary=False):
    last_exc = None
    for attempt in range(1, RETRIES + 1):
        try:
            resp = session.get(url, timeout=TIMEOUT)
            resp.raise_for_status()
            return resp.content if binary else resp.text
        except Exception as e:  # noqa: BLE001
            last_exc = e
            time.sleep(0.5 * attempt)
    log.error("FAILED to fetch %s after %d attempts: %s", url, RETRIES, last_exc)
    return None


def sanitize_filename(name):
    name = unquote(name)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    return name.strip()


def strip_tags(fragment):
    text = re.sub(r"(?i)<br\s*/?>", "\n", fragment)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = html.unescape(text)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n")]
    return [ln for ln in lines if ln]


def find_gallery_links(category_page_url, html_text):
    links = set()
    for m in re.finditer(r"MM_openBrWindow\('([^']+)'", html_text):
        links.add(m.group(1))
    return sorted(urljoin(category_page_url, l) for l in links)


def parse_gallery_index(gallery_url, html_text):
    """Return (series_title, [(item_url, thumb_url, alt_text), ...]) preserving order."""
    series_title = ""
    m = re.search(r"<FONT size=3 face=Helvetica>(.*?)<br>", html_text, re.I | re.S)
    if m:
        lines = strip_tags(m.group(1))
        series_title = lines[0] if lines else ""

    items = []
    seen = set()
    pattern = re.compile(
        r'<A\s+name=\d+\s+href="([^"]+)"><IMG\s+src="([^"]+)"[^>]*alt="([^"]*)"',
        re.I,
    )
    for m in pattern.finditer(html_text):
        href, thumb, alt = m.group(1), m.group(2), html.unescape(m.group(3))
        if href in seen:
            continue
        seen.add(href)
        items.append((urljoin(gallery_url, href), urljoin(gallery_url, thumb), alt))
    return series_title, items


PRICE_RE = re.compile(r"(?:([A-Za-z]+)\s*:\s*)?£\s*([\d,]+(?:\.\d{2})?)")
DIMS_RE = re.compile(r"\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*cm(?:\s*\([^)]*\))?", re.I)


def parse_item_page(item_url, category, gallery_name, series_title_fallback, thumb_url, alt_text):
    text = fetch(item_url)
    if text is None:
        return None

    title_m = re.search(r"<TITLE>(.*?)</TITLE>", text, re.I | re.S)
    page_title = html.unescape(title_m.group(1)).strip() if title_m else alt_text

    block_m = re.search(
        r'<TABLE border="0" cellpadding="5" cellspacing="2" width="100%".*?<TD[^>]*>(.*?)</TR>\s*</TABLE>',
        text,
        re.I | re.S,
    )
    block_html = block_m.group(1) if block_m else ""
    sold = bool(re.search(r"color=\s*red[^>]*>\s*SOLD", block_html, re.I))
    lines = strip_tags(block_html)

    series_title = lines[0] if lines else series_title_fallback
    detail_lines = []
    for ln in lines[1:]:
        ln = re.sub(r"\s*SOLD\s*$", "", ln, flags=re.I).strip()
        if ln:
            detail_lines.append(ln)
    raw_text = " / ".join(detail_lines)

    prices = [f"{lbl.strip()}: £{amt}" if lbl.strip() else f"£{amt}" for lbl, amt in PRICE_RE.findall(raw_text)]
    dims = DIMS_RE.findall(raw_text)

    img_m = re.search(
        r'<IMG src="(\.\./images/(?!previous\.gif|home\.gif|next\.gif)[^"]+)"',
        text,
        re.I,
    )
    image_url = urljoin(item_url, img_m.group(1)) if img_m else None
    if image_url is None:
        log.warning("No full-size image found on %s", item_url)

    local_rel = None
    if image_url:
        fname = sanitize_filename(Path(urlparse(image_url).path).name)
        local_rel = f"{category}/{gallery_name}/{fname}"

    return {
        "category": category,
        "gallery": gallery_name,
        "series_title": series_title,
        "page_title": page_title,
        "raw_text": raw_text,
        "detail_lines": detail_lines,
        "prices": prices,
        "dimensions": dims,
        "sold": sold,
        "source_page_url": item_url,
        "thumbnail_url": thumb_url,
        "image_url": image_url,
        "image_local_path": local_rel,
    }


def download_image(record):
    if not record.get("image_url"):
        return record
    dest = IMG_DIR / record["image_local_path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return record
    data = fetch(record["image_url"], binary=True)
    if data is None:
        record["image_download_failed"] = True
        return record
    dest.write_bytes(data)
    return record


def handle_special_page(gallery_url, category):
    """One-off gallery links that aren't a standard index.html (e.g. digital/blk-brg-digital.html)."""
    text = fetch(gallery_url)
    if text is None:
        return None
    title_m = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
    title = html.unescape(title_m.group(1)).strip() if title_m else gallery_url
    img_m = re.search(r'<img[^>]+src="([^"]+)"', text, re.I)
    image_url = urljoin(gallery_url, img_m.group(1)) if img_m else None
    gallery_name = Path(urlparse(gallery_url).path).stem
    local_rel = None
    if image_url:
        fname = sanitize_filename(Path(urlparse(image_url).path).name)
        local_rel = f"{category}/{gallery_name}/{fname}"
    log.info("SPECIAL PAGE (manual review suggested): %s -> %s", gallery_url, title)
    return {
        "category": category,
        "gallery": gallery_name,
        "series_title": title,
        "page_title": title,
        "raw_text": "",
        "detail_lines": [],
        "prices": [],
        "dimensions": [],
        "sold": False,
        "source_page_url": gallery_url,
        "thumbnail_url": None,
        "image_url": image_url,
        "image_local_path": local_rel,
        "special_page": True,
    }


def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    all_records = []

    gallery_tasks = []  # (category, gallery_url)
    for category, page in CATEGORY_PAGES.items():
        cat_url = urljoin(BASE + "/", page)
        text = fetch(cat_url)
        if text is None:
            log.error("Could not fetch category page %s", cat_url)
            continue
        links = find_gallery_links(cat_url, text)
        log.info("%s: found %d gallery links", category, len(links))
        for l in links:
            gallery_tasks.append((category, l))

    item_tasks = []  # (category, gallery_name, item_url, thumb_url, alt, series_fallback)
    for category, gallery_url in gallery_tasks:
        gallery_name = Path(urlparse(gallery_url).path).parent.name or Path(urlparse(gallery_url).path).stem
        if not gallery_url.lower().endswith("index.html"):
            rec = handle_special_page(gallery_url, category)
            if rec:
                all_records.append(rec)
            continue

        text = fetch(gallery_url)
        if text is None:
            log.error("Could not fetch gallery index %s", gallery_url)
            continue
        series_title, items = parse_gallery_index(gallery_url, text)
        if not items:
            log.warning("No items found in gallery %s (series_title=%r)", gallery_url, series_title)
        for item_url, thumb_url, alt in items:
            item_tasks.append((category, gallery_name, item_url, thumb_url, alt, series_title))

    log.info("Discovered %d item pages across %d galleries", len(item_tasks), len(gallery_tasks))

    def worker(task):
        category, gallery_name, item_url, thumb_url, alt, series_fallback = task
        rec = parse_item_page(item_url, category, gallery_name, series_fallback, thumb_url, alt)
        if rec:
            rec = download_image(rec)
        return rec

    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(worker, t): t for t in item_tasks}
        for fut in as_completed(futures):
            rec = fut.result()
            done += 1
            if rec:
                all_records.append(rec)
            if done % 25 == 0:
                log.info("Progress: %d/%d items processed", done, len(item_tasks))
                CHECKPOINT_PATH.write_text(json.dumps(all_records, indent=2, ensure_ascii=False), encoding="utf-8")

    JSON_PATH.write_text(json.dumps(all_records, indent=2, ensure_ascii=False), encoding="utf-8")
    if CHECKPOINT_PATH.exists():
        CHECKPOINT_PATH.unlink()

    fieldnames = [
        "category", "gallery", "series_title", "page_title", "sold",
        "dimensions", "prices", "raw_text", "image_local_path", "image_url",
        "source_page_url", "special_page",
    ]
    with CSV_PATH.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for rec in all_records:
            row = dict(rec)
            row["dimensions"] = "; ".join(rec.get("dimensions") or [])
            row["prices"] = "; ".join(rec.get("prices") or [])
            writer.writerow(row)

    sold_count = sum(1 for r in all_records if r.get("sold"))
    failed_images = sum(1 for r in all_records if r.get("image_download_failed"))
    log.info(
        "DONE. %d records, %d sold, %d image download failures. JSON=%s CSV=%s",
        len(all_records), sold_count, failed_images, JSON_PATH, CSV_PATH,
    )


if __name__ == "__main__":
    main()
