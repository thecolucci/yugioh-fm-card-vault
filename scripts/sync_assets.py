from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import time
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from lxml import html
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCES = ASSETS / "sources"
CARD_DIR = ASSETS / "cards"
PUBLIC_CARD_DIR = ROOT / "public" / "cards"
ICON_DIR = ASSETS / "type-icons"
PUBLIC_ICON_DIR = ROOT / "public" / "type-icons"
PUBLIC_GAME_DIR = ROOT / "public" / "game-assets"

USER_AGENT = "YuGiOh-FM-Card-Archive/1.0 (local fan project)"
FUSION_FULL_CARD_ROOT = "https://fusion.lukadevv.com/assets/cards/full"
FANDOM_CARD_BACK_MARKER = "/Back-FMR-"
KNOWN_CARD_BACK_SHA256 = "8a2d83baf7a3269fe341df209b1bb02683189ad042e29486ef7b4733c8c3394a"

SOURCE_FILES = (
    "fandom-card-table.json",
    "fandom-gallery.json",
    "fandom-images.json",
    "fandom-card-list.json",
    "yugipedia-icons.json",
)


def ensure_source_layout() -> None:
    SOURCES.mkdir(parents=True, exist_ok=True)
    for filename in SOURCE_FILES:
        current = ROOT / filename
        destination = SOURCES / filename
        if current.exists() and not destination.exists():
            shutil.move(str(current), str(destination))


def clean_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")


def parse_cards() -> list[dict[str, object]]:
    source = json.loads((SOURCES / "fandom-card-table.json").read_text(encoding="utf-8"))
    document = html.fromstring(source["parse"]["text"])
    gamefaqs_path = SOURCES / "gamefaqs-card-data.json"
    gamefaqs = {
        row["id"]: row
        for row in json.loads(gamefaqs_path.read_text(encoding="utf-8"))
    }
    cards: list[dict[str, object]] = []

    for table in document.xpath('//table[contains(@class,"card-list")]'):
        for row in table.xpath('.//tr[position()>1]'):
            values = [clean_text(" ".join(cell.itertext())) for cell in row.xpath("./td")]
            if len(values) != 9 or not values[0].isdigit():
                continue
            number, name, card_type, monster_type, level, attack, defense, password, cost = values
            guide = gamefaqs.get(number.zfill(3))
            if guide:
                name = guide["name"]
                password = guide["password"]
                cost = guide["cost"]
            cards.append(
                {
                    "id": number.zfill(3),
                    "name": name,
                    "cardType": card_type,
                    "type": monster_type or card_type,
                    "level": int(level) if level.isdigit() else None,
                    "attack": int(attack) if attack.isdigit() else None,
                    "defense": int(defense) if defense.isdigit() else None,
                    "password": password if password and password not in {"N/A", "—", "-"} else None,
                    "cost": int(cost.replace(",", "")) if cost.replace(",", "").isdigit() else None,
                    "image": f"/cards/{number.zfill(3)}.webp",
                }
            )

    cards.sort(key=lambda card: int(str(card["id"])))
    if len(cards) != 722:
        raise RuntimeError(f"Expected 722 cards, parsed {len(cards)}")
    if len(gamefaqs) != 722:
        raise RuntimeError(f"Expected 722 GameFAQs entries, parsed {len(gamefaqs)}")
    return cards


def parse_gallery() -> dict[str, str]:
    source = json.loads((SOURCES / "fandom-gallery.json").read_text(encoding="utf-8"))
    document = html.fromstring(source["parse"]["text"])
    image_urls: dict[str, str] = {}

    for block in document.xpath('//div[contains(@style,"width: 175px")]'):
        text = clean_text(" ".join(block.itertext()))
        number_match = re.search(r"#(\d{3})", text)
        links = block.xpath('.//a[contains(@class,"mw-file-description")]/@href')
        if number_match and links:
            number = number_match.group(1)
            source = links[0]
            image_urls[number] = (
                f"{FUSION_FULL_CARD_ROOT}/{number}.webp"
                if FANDOM_CARD_BACK_MARKER in source
                else source
            )

    if len(image_urls) != 722:
        raise RuntimeError(f"Expected 722 gallery images, mapped {len(image_urls)}")
    return image_urls


def fetch_bytes(url: str, retries: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
        },
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except Exception as error:  # noqa: BLE001 - retry boundary
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not download {url}: {last_error}")


def save_webp(data: bytes, destination: Path, max_width: int = 420) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        image = source.convert("RGB")
        if image.width > max_width:
            height = round(image.height * (max_width / image.width))
            image = image.resize((max_width, height), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=84, method=6)


def is_known_card_back(path: Path) -> bool:
    if not path.exists():
        return False
    return hashlib.sha256(path.read_bytes()).hexdigest() == KNOWN_CARD_BACK_SHA256


def sync_card_image(number: str, url: str) -> tuple[str, str]:
    asset_path = CARD_DIR / f"{number}.webp"
    public_path = PUBLIC_CARD_DIR / f"{number}.webp"
    if not asset_path.exists() or is_known_card_back(asset_path):
        data = fetch_bytes(url)
        if url.startswith(FUSION_FULL_CARD_ROOT):
            with Image.open(io.BytesIO(data)) as source:
                source.load()
                if source.width < 120 or source.height < 170:
                    raise RuntimeError(f"Fusion card {number} has invalid dimensions: {source.size}")
            asset_path.parent.mkdir(parents=True, exist_ok=True)
            asset_path.write_bytes(data)
        else:
            save_webp(data, asset_path)
    public_path.parent.mkdir(parents=True, exist_ok=True)
    if not public_path.exists() or public_path.read_bytes() != asset_path.read_bytes():
        shutil.copy2(asset_path, public_path)
    return number, "ok"


def query_icon_urls() -> dict[str, str]:
    source = json.loads((SOURCES / "yugipedia-icons.json").read_text(encoding="utf-8"))
    titles = [item["title"] for item in source["query"]["categorymembers"]]
    endpoint = "https://yugipedia.com/api.php?" + urllib.parse.urlencode(
        {
            "action": "query",
            "prop": "imageinfo",
            "iiprop": "url",
            "titles": "|".join(titles),
            "format": "json",
            "formatversion": 2,
        }
    )
    payload = json.loads(fetch_bytes(endpoint).decode("utf-8"))
    results: dict[str, str] = {}
    for page in payload["query"]["pages"]:
        if "imageinfo" not in page:
            continue
        name = page["title"].removeprefix("File:").removesuffix(".png")
        results[name] = page["imageinfo"][0]["url"]
    return results


def sync_type_icons() -> None:
    for name, url in query_icon_urls().items():
        filename = f"{slugify(name)}.png"
        asset_path = ICON_DIR / filename
        public_path = PUBLIC_ICON_DIR / filename
        if not asset_path.exists():
            data = fetch_bytes(url)
            asset_path.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(io.BytesIO(data)) as source:
                source.load()
                image = source.convert("RGBA")
                if image.width > 96 or image.height > 96:
                    image.thumbnail((96, 96), Image.Resampling.LANCZOS)
                image.save(asset_path, "PNG", optimize=True)
        public_path.parent.mkdir(parents=True, exist_ok=True)
        if not public_path.exists() or public_path.stat().st_size != asset_path.stat().st_size:
            shutil.copy2(asset_path, public_path)


def write_data(cards: list[dict[str, object]], gallery: dict[str, str]) -> None:
    data_dir = ASSETS / "data"
    app_data_dir = ROOT / "app" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    app_data_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "meta": {
            "count": len(cards),
            "sources": {
                "images": "https://yugioh.fandom.com/wiki/Gallery_of_Yu-Gi-Oh!_Forbidden_Memories_cards",
                "passwords": "https://gamefaqs.gamespot.com/ps/561010-yu-gi-oh-forbidden-memories/faqs/18828",
                "typeIcons": "https://yugipedia.com/wiki/Category:Yu-Gi-Oh!_Forbidden_Memories_Type_icons",
            },
        },
        "cards": cards,
    }
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (data_dir / "cards.json").write_text(serialized, encoding="utf-8")
    (app_data_dir / "cards.json").write_text(serialized, encoding="utf-8")

    gallery_payload = {
        number: {"source": url, "local": f"/cards/{number}.webp"}
        for number, url in sorted(gallery.items())
    }
    (data_dir / "image-sources.json").write_text(
        json.dumps(gallery_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def write_sprite_map() -> None:
    sprite_map = {
        "cardsFrames": {
            "sheet": "Cards Frames.png",
            "size": [1320, 488],
            "sprites": {
                "cardBack": {"x": 10, "y": 41, "width": 140, "height": 196},
                "goldFrameA": {"x": 155, "y": 41, "width": 140, "height": 196},
                "goldFrameB": {"x": 300, "y": 41, "width": 140, "height": 196},
                "greenFrameA": {"x": 445, "y": 41, "width": 140, "height": 196},
                "greenFrameB": {"x": 590, "y": 41, "width": 140, "height": 196},
                "pinkFrameA": {"x": 735, "y": 41, "width": 140, "height": 196},
                "pinkFrameB": {"x": 880, "y": 41, "width": 140, "height": 196},
                "blueFrameA": {"x": 1025, "y": 41, "width": 140, "height": 196},
                "blueFrameB": {"x": 1170, "y": 41, "width": 140, "height": 196},
                "purpleFrameA": {"x": 10, "y": 282, "width": 140, "height": 196},
                "purpleFrameB": {"x": 155, "y": 282, "width": 140, "height": 196},
                "orangeFrameA": {"x": 300, "y": 282, "width": 140, "height": 196},
                "orangeFrameB": {"x": 445, "y": 282, "width": 140, "height": 196},
            },
        },
        "inputScreen": {
            "sheet": "Frame - Input Screen & Font Assets.png",
            "size": [710, 452],
            "sprites": {
                "stonePanel": {"x": 10, "y": 200, "width": 330, "height": 242},
                "textBoxWide": {"x": 360, "y": 200, "width": 170, "height": 54},
                "textBoxShort": {"x": 360, "y": 264, "width": 130, "height": 54},
                "verticalOrnament": {"x": 360, "y": 328, "width": 36, "height": 85},
                "thinOrnament": {"x": 406, "y": 330, "width": 294, "height": 13},
                "wideOrnament": {"x": 406, "y": 363, "width": 294, "height": 26},
            },
        },
        "gameOver": {
            "sheet": "Miscellaneous - Game Over Screen.png",
            "size": [350, 383],
            "sprites": {
                "stoneScene": {"x": 10, "y": 42, "width": 330, "height": 242},
                "kuribohIdle": {"x": 10, "y": 339, "width": 30, "height": 34},
                "kuribohJump": {"x": 50, "y": 340, "width": 34, "height": 33},
                "kuribohLand": {"x": 95, "y": 342, "width": 30, "height": 31},
            },
        },
        "pharaoh": {
            "sheet": "Character Yugi - Pharaoh.png",
            "size": [184, 304],
            "sprites": {"portrait": {"x": 0, "y": 13, "width": 181, "height": 291}},
        },
    }
    (ASSETS / "sprite-map.json").write_text(
        json.dumps(sprite_map, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def copy_game_assets() -> None:
    PUBLIC_GAME_DIR.mkdir(parents=True, exist_ok=True)
    for filename in (
        "logo_yugioh_fm.webp",
        "web-background.png",
        "icon_eye_millenium.png",
        "icon_starchip.png",
        "Cards Frames.png",
        "Frame - Input Screen & Font Assets.png",
        "Miscellaneous - Game Over Screen.png",
        "Character Yugi - Pharaoh.png",
    ):
        source = ASSETS / filename
        if source.exists():
            shutil.copy2(source, PUBLIC_GAME_DIR / filename)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the local Forbidden Memories card archive")
    parser.add_argument("--download", action="store_true", help="Download and optimize card art and icons")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()

    ensure_source_layout()
    cards = parse_cards()
    gallery = parse_gallery()
    write_data(cards, gallery)
    write_sprite_map()
    copy_game_assets()

    if args.download:
        CARD_DIR.mkdir(parents=True, exist_ok=True)
        PUBLIC_CARD_DIR.mkdir(parents=True, exist_ok=True)
        failures: list[tuple[str, str]] = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(sync_card_image, number, url): number
                for number, url in gallery.items()
            }
            for index, future in enumerate(as_completed(futures), start=1):
                number = futures[future]
                try:
                    future.result()
                except Exception as error:  # noqa: BLE001 - collect all failed assets
                    failures.append((number, str(error)))
                if index % 50 == 0 or index == len(futures):
                    print(f"Cards processed: {index}/{len(futures)}")
        sync_type_icons()
        if failures:
            for number, error in failures:
                print(f"FAILED {number}: {error}")
            raise RuntimeError(f"{len(failures)} card images failed")

    print(f"Prepared {len(cards)} cards and {len(gallery)} image mappings.")


if __name__ == "__main__":
    main()
