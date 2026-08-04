"""Archive the assets observed on fusion.lukadevv.com.

The browser asset inventory keeps original URLs in a manifest but stores the
downloaded files under hashed names. This script restores the original public
paths, keeps the inventory for auditing, and preserves the upstream GPL notice.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from urllib.parse import unquote, urlparse


def destination_for(asset: dict[str, object], root: Path) -> Path:
    url = str(asset["url"])
    source = Path(str(asset["path"]))

    if url.startswith("inline-svg:"):
        return root / "deployed" / "inline" / f"{asset['id']}{source.suffix}"

    parsed = urlparse(url)
    relative = Path(unquote(parsed.path.lstrip("/")))
    if not relative.name:
        relative = Path("unnamed") / source.name
    return root / "deployed" / relative


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-manifest", required=True, type=Path)
    parser.add_argument("--upstream-repo", required=True, type=Path)
    parser.add_argument(
        "--destination",
        type=Path,
        default=Path("assets/fusion-reference"),
    )
    args = parser.parse_args()

    manifest = json.loads(args.bundle_manifest.read_text(encoding="utf-8"))
    destination = args.destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)

    archived: list[dict[str, object]] = []
    for asset in manifest["assets"]:
        source = Path(asset["path"])
        target = destination_for(asset, destination)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        archived.append(
            {
                "id": asset["id"],
                "kind": asset["kind"],
                "contentType": asset.get("contentType"),
                "name": asset["name"],
                "url": asset["url"],
                "localPath": target.relative_to(destination).as_posix(),
            }
        )

    public_source = args.upstream_repo / "public"
    if public_source.exists():
        shutil.copytree(
            public_source,
            destination / "upstream-public",
            dirs_exist_ok=True,
        )

    for filename in ("LICENSE", "README.md", "package.json", "vite.config.ts"):
        source = args.upstream_repo / filename
        if source.exists():
            target = destination / "upstream-project" / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    inventory = {
        "sourcePage": "https://fusion.lukadevv.com/cards",
        "sourceRepository": "https://github.com/lukadevv/fusion-simulator/",
        "assetCount": len(archived),
        "assets": archived,
    }
    (destination / "inventory.json").write_text(
        json.dumps(inventory, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Archived {len(archived)} deployed assets in {destination}")


if __name__ == "__main__":
    main()
