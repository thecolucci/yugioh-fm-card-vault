"""Build deterministic, ID-ordered Forbidden Memories sprite assets."""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "minicards" / "icons"
REFERENCE_DIR = ROOT / "assets" / "fusion-reference" / "deployed" / "assets" / "v2" / "spritesheets"
ASSET_OUTPUT = ROOT / "assets" / "minicards"
PUBLIC_OUTPUT = ROOT / "public" / "game-assets" / "fusion"

CELL_WIDTH = 102
CELL_HEIGHT = 96
COLUMNS = 26
CARD_COUNT = 722
ROWS = math.ceil(CARD_COUNT / COLUMNS)

FRAME_SPRITES = {
    "monster": {"x": 0, "y": 0, "width": 123, "height": 154},
    "magic": {"x": 123, "y": 0, "width": 123, "height": 154},
    "cardBack": {"x": 246, "y": 0, "width": 72, "height": 90},
    "miniBadgePanel": {"x": 246, "y": 90, "width": 72, "height": 64},
    "ritual": {"x": 318, "y": 0, "width": 123, "height": 154},
    "trap": {"x": 0, "y": 154, "width": 123, "height": 154},
    "blankMonster": {"x": 123, "y": 154, "width": 123, "height": 154},
    "equip": {"x": 318, "y": 154, "width": 123, "height": 154},
}

TYPE_ICON_COORDS = {
    "Warrior": (68, 187),
    "Fiend": (0, 153),
    "Aqua": (34, 153),
    "Spellcaster": (170, 170),
    "Machine": (153, 153),
    "Beast": (68, 153),
    "Insect": (51, 153),
    "Dragon": (136, 153),
    "Zombie": (102, 187),
    "Fairy": (175, 102),
    "Winged Beast": (85, 187),
    "Rock": (119, 170),
    "Plant": (51, 170),
    "Fish": (17, 153),
    "Beast-Warrior": (102, 153),
    "Thunder": (17, 187),
    "Dinosaur": (119, 153),
    "Reptile": (102, 170),
    "Pyro": (85, 170),
    "Sea Serpent": (153, 170),
}

# Exact 7 × 8 game-font cells used by Fusion's minicard ATK/DEF renderer.
# The 9 glyph is packed separately from the 0–8 run in main.png.
STAT_DIGIT_COORDS = {
    "0": (119, 187),
    "1": (127, 187),
    "2": (135, 187),
    "3": (143, 187),
    "4": (151, 187),
    "5": (159, 187),
    "6": (167, 187),
    "7": (175, 187),
    "8": (183, 187),
    "9": (180, 133),
}


def build_card_sheet() -> tuple[Path, dict[str, dict[str, int]]]:
    sheet = Image.new(
        "RGBA",
        (COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT),
        (0, 0, 0, 0),
    )
    cards: dict[str, dict[str, int]] = {}

    for index in range(CARD_COUNT):
        card_id = f"{index + 1:03d}"
        source = ICON_DIR / f"{card_id}.PNG"
        icon = Image.open(source).convert("RGBA")
        if icon.size != (CELL_WIDTH, CELL_HEIGHT):
            raise ValueError(f"Unexpected size for {source}: {icon.size}")

        column = index % COLUMNS
        row = index // COLUMNS
        x = column * CELL_WIDTH
        y = row * CELL_HEIGHT
        sheet.paste(icon, (x, y))
        cards[card_id] = {
            "x": x,
            "y": y,
            "width": CELL_WIDTH,
            "height": CELL_HEIGHT,
            "column": column,
            "row": row,
        }

    output = ASSET_OUTPUT / "minicards-by-id.webp"
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "WEBP", quality=90, method=6, exact=True)
    return output, cards


def map_fusion_card_sheet() -> tuple[Path, dict[str, dict[str, int]]]:
    """Match every numbered PNG to its cell in Fusion's shuffled sheet."""

    source = REFERENCE_DIR / "cards.webp"
    sheet = Image.open(source).convert("RGB")
    if sheet.size != (COLUMNS * CELL_WIDTH, ROWS * CELL_HEIGHT):
        raise ValueError(f"Unexpected Fusion card sheet size: {sheet.size}")

    sheet_features = []
    for row in range(ROWS):
        for column in range(COLUMNS):
            crop = sheet.crop(
                (
                    column * CELL_WIDTH,
                    row * CELL_HEIGHT,
                    (column + 1) * CELL_WIDTH,
                    (row + 1) * CELL_HEIGHT,
                )
            ).resize((12, 12), Image.Resampling.BILINEAR)
            sheet_features.append(np.asarray(crop, dtype=np.float32).reshape(-1))
    feature_matrix = np.stack(sheet_features)

    matches: dict[str, dict[str, int]] = {}
    occupied: set[int] = set()
    for index in range(CARD_COUNT):
        card_id = f"{index + 1:03d}"
        icon = (
            Image.open(ICON_DIR / f"{card_id}.PNG")
            .convert("RGB")
            .resize((12, 12), Image.Resampling.BILINEAR)
        )
        feature = np.asarray(icon, dtype=np.float32).reshape(-1)
        distances = np.mean((feature_matrix - feature) ** 2, axis=1)
        match = int(np.argmin(distances))
        if match in occupied:
            raise ValueError(f"Duplicate Fusion sprite match at cell {match}")
        occupied.add(match)

        column = match % COLUMNS
        row = match // COLUMNS
        matches[card_id] = {
            "x": column * CELL_WIDTH,
            "y": row * CELL_HEIGHT,
            "width": CELL_WIDTH,
            "height": CELL_HEIGHT,
            "column": column,
            "row": row,
        }

    if len(matches) != CARD_COUNT:
        raise ValueError("Incomplete Fusion sprite mapping")
    return source, matches


def copy_runtime_asset(name: str) -> None:
    source = REFERENCE_DIR / name
    if not source.exists():
        raise FileNotFoundError(source)
    shutil.copy2(source, ASSET_OUTPUT / name)
    shutil.copy2(source, PUBLIC_OUTPUT / name)


def main() -> None:
    PUBLIC_OUTPUT.mkdir(parents=True, exist_ok=True)
    sheet_path, cards = build_card_sheet()
    shutil.copy2(sheet_path, PUBLIC_OUTPUT / "minicards.webp")

    fusion_sheet_path, fusion_cards = map_fusion_card_sheet()
    shutil.copy2(fusion_sheet_path, ASSET_OUTPUT / "cards-fusion.webp")
    shutil.copy2(fusion_sheet_path, PUBLIC_OUTPUT / "cards.webp")

    copy_runtime_asset("frames.webp")
    copy_runtime_asset("main.png")

    sprite_map = {
        "sources": {
            "fusionCardsPage": "https://fusion.lukadevv.com/cards",
            "fusionFrames": "https://fusion.lukadevv.com/assets/v2/spritesheets/frames.webp",
            "fusionMain": "https://fusion.lukadevv.com/assets/v2/spritesheets/main.png",
        },
        "minicards": {
            "file": "minicards-by-id.webp",
            "width": COLUMNS * CELL_WIDTH,
            "height": ROWS * CELL_HEIGHT,
            "columns": COLUMNS,
            "rows": ROWS,
            "cell": {"width": CELL_WIDTH, "height": CELL_HEIGHT},
            "ordering": "ascending card ID, left-to-right then top-to-bottom",
            "cards": cards,
        },
        "fusionMinicards": {
            "file": "cards-fusion.webp",
            "width": COLUMNS * CELL_WIDTH,
            "height": ROWS * CELL_HEIGHT,
            "columns": COLUMNS,
            "rows": ROWS,
            "cell": {"width": CELL_WIDTH, "height": CELL_HEIGHT},
            "ordering": "upstream compression-optimized order; explicit coordinates below",
            "runtimePreset": {
                "element": {"width": 62.54, "height": 56.64},
                "backgroundSize": {"width": 1626.04, "height": 1585.92},
            },
            "cards": fusion_cards,
        },
        "frames": {
            "file": "frames.webp",
            "width": 441,
            "height": 308,
            "sprites": FRAME_SPRITES,
            "runtimePreset": {
                "element": {"width": 72, "height": 90},
                "backgroundSize": {"width": 258.15, "height": 180},
                "positions": {
                    "Monster": {"x": 0, "y": 0},
                    "Magic": {"x": -72, "y": 0},
                    "Field": {"x": -72, "y": 0},
                    "Ritual": {"x": -186.15, "y": 0},
                    "Trap": {"x": 0, "y": -90},
                    "Equip": {"x": -186.15, "y": -90},
                },
            },
        },
        "main": {
            "file": "main.png",
            "width": 191,
            "height": 203,
            "typeIcons": {
                name: {"x": xy[0], "y": xy[1], "width": 16, "height": 16}
                for name, xy in TYPE_ICON_COORDS.items()
            },
            "statDigits": {
                digit: {"x": xy[0], "y": xy[1], "width": 7, "height": 8}
                for digit, xy in STAT_DIGIT_COORDS.items()
            },
        },
    }

    mapping_path = ASSET_OUTPUT / "sprite-map.json"
    mapping_path.write_text(
        json.dumps(sprite_map, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    shutil.copy2(mapping_path, PUBLIC_OUTPUT / "sprite-map.json")
    shutil.copy2(mapping_path, ROOT / "app" / "data" / "minicard-sprite-map.json")

    print(
        f"Built {sheet_path.name} ({sheet_path.stat().st_size:,} bytes) "
        f"and mapped {len(cards)} cards in both deterministic and Fusion order"
    )


if __name__ == "__main__":
    main()
