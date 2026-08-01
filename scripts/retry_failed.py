"""
Retry pass for items that failed during the main crawl (mostly 403s from
bursty concurrent requests hitting the same gallery folder, plus a couple of
connection timeouts). Runs single-threaded with a delay between requests to
avoid tripping whatever basic rate-limiting the host has, and merges any
newly-recovered records into output/data.json / data.csv.
"""
import json
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "output"


def rebuild_full_task_list():
    gallery_tasks = []
    for category, page in scrape.CATEGORY_PAGES.items():
        cat_url = urljoin(scrape.BASE + "/", page)
        text = scrape.fetch(cat_url)
        if text is None:
            continue
        for l in scrape.find_gallery_links(cat_url, text):
            gallery_tasks.append((category, l))

    item_tasks = []
    special_tasks = []
    for category, gallery_url in gallery_tasks:
        if not gallery_url.lower().endswith("index.html"):
            special_tasks.append((category, gallery_url))
            continue
        gallery_name = Path(urlparse(gallery_url).path).parent.name
        text = scrape.fetch(gallery_url)
        if text is None:
            continue
        series_title, items = scrape.parse_gallery_index(gallery_url, text)
        for item_url, thumb_url, alt in items:
            item_tasks.append((category, gallery_name, item_url, thumb_url, alt, series_title))
    return item_tasks, special_tasks


def main():
    data = json.loads((OUT_DIR / "data.json").read_text(encoding="utf-8"))
    existing_urls = {r["source_page_url"] for r in data}
    failed_image_records = [r for r in data if r.get("image_download_failed")]

    print(f"Existing records: {len(data)}")
    print(f"Records with failed image downloads: {len(failed_image_records)}")

    item_tasks, special_tasks = rebuild_full_task_list()
    missing = [t for t in item_tasks if t[2] not in existing_urls]
    print(f"Total discovered items: {len(item_tasks)}; missing: {len(missing)}")

    recovered = 0
    for task in missing:
        category, gallery_name, item_url, thumb_url, alt, series_fallback = task
        time.sleep(1.5)
        rec = scrape.parse_item_page(item_url, category, gallery_name, series_fallback, thumb_url, alt)
        if rec is None:
            print(f"STILL FAILING: {item_url}")
            continue
        time.sleep(1.0)
        rec = scrape.download_image(rec)
        data.append(rec)
        recovered += 1
        print(f"Recovered ({recovered}/{len(missing)}): {rec['page_title']}")

    for category, gallery_url in special_tasks:
        if gallery_url in existing_urls:
            continue
        time.sleep(1.5)
        rec = scrape.handle_special_page(gallery_url, category)
        if rec:
            data.append(rec)
            recovered += 1

    for rec in failed_image_records:
        time.sleep(1.0)
        dest = scrape.IMG_DIR / rec["image_local_path"]
        if dest.exists() and dest.stat().st_size > 0:
            rec.pop("image_download_failed", None)
            continue
        new_rec = scrape.download_image(rec)
        if not new_rec.get("image_download_failed"):
            print(f"Recovered image for: {rec['page_title']}")

    (OUT_DIR / "data.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    import csv
    fieldnames = [
        "category", "gallery", "series_title", "page_title", "sold",
        "dimensions", "prices", "raw_text", "image_local_path", "image_url",
        "source_page_url", "special_page",
    ]
    with (OUT_DIR / "data.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for rec in data:
            row = dict(rec)
            row["dimensions"] = "; ".join(rec.get("dimensions") or [])
            row["prices"] = "; ".join(rec.get("prices") or [])
            writer.writerow(row)

    still_missing = len(missing) - recovered
    print(f"DONE. Recovered {recovered} records. Total now: {len(data)}. Still missing: {still_missing}")


if __name__ == "__main__":
    main()
