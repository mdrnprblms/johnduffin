"""
Re-derives the correct browsing order that was lost in the original scrape
(item detail pages were fetched concurrently, so output/data.json's record
order doesn't match the site's actual sequence).

Only re-fetches the lightweight category + gallery index pages (no images,
no detail pages) to recover:
  - seriesOrder: position of a gallery/series within its category, in the
    order it was listed on the category page (site lists newest first)
  - order: position of an item within its gallery, in thumbnail order

Writes output/ordering.json: {source_page_url: {gallery, seriesOrder, order}}
"""
import json
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "output" / "ordering.json"


def main():
    ordering = {}

    for category, page in scrape.CATEGORY_PAGES.items():
        cat_url = urljoin(scrape.BASE + "/", page)
        text = scrape.fetch(cat_url)
        if text is None:
            print(f"FAILED category page {cat_url}")
            continue
        gallery_links = scrape.find_gallery_links(cat_url, text)

        series_order = 0
        for gallery_url in gallery_links:
            if not gallery_url.lower().endswith("index.html"):
                # special one-off page (e.g. blk-brg-digital.html)
                ordering[gallery_url] = {
                    "gallery": Path(gallery_url.rstrip("/").split("/")[-1]).stem,
                    "seriesOrder": series_order,
                    "order": 0,
                }
                series_order += 1
                continue

            gtext = scrape.fetch(gallery_url)
            if gtext is None:
                print(f"FAILED gallery index {gallery_url}")
                continue
            _, items = scrape.parse_gallery_index(gallery_url, gtext)
            gallery_name = Path(urlparse(gallery_url).path).parent.name

            for item_order, (item_url, _thumb, _alt) in enumerate(items, start=1):
                ordering[item_url] = {
                    "gallery": gallery_name,
                    "seriesOrder": series_order,
                    "order": item_order,
                }
            series_order += 1
            print(f"{category}/{gallery_name}: {len(items)} items, seriesOrder={series_order - 1}")

    OUT_PATH.write_text(json.dumps(ordering, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(ordering)} ordering entries to {OUT_PATH}")


if __name__ == "__main__":
    main()
