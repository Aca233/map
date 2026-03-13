from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


PORTRAIT_MAP = {
    "FRA": "FRA/Portrait_France_Edouard_Daladier.dds",
    "USA": "USA/Portrait_USA_Franklin_Roosevelt.dds",
    "ENG": "ENG/Portrait_Britain_Stanley_Baldwin.dds",
    "GER": "GER/portrait_GER_adolf_hitler.dds",
    "ITA": "ITA/Portrait_Italy_Benito_Mussolini.dds",
    "JAP": "JAP/Portrait_Japan_Hirohito.dds",
    "SOV": "SOV/Portrait_Soviet_Joseph_Stalin.dds",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Export selected HOI4 leader portraits to PNG assets.")
    parser.add_argument("--source-root", required=True, help="HOI4 gfx/leaders directory")
    parser.add_argument("--output-dir", required=True, help="Output directory for PNG portraits")
    parser.add_argument("tags", nargs="+", help="Country tags to export")
    args = parser.parse_args()

    source_root = Path(args.source_root)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    exported: list[str] = []
    for raw_tag in args.tags:
        tag = raw_tag.upper()
        relative_path = PORTRAIT_MAP.get(tag)
        if not relative_path:
            continue

        source_file = source_root / relative_path
        if not source_file.exists():
            continue

        output_file = output_dir / f"{tag}.png"
        with Image.open(source_file) as image:
            image.save(output_file, format="PNG")
        exported.append(output_file.name)

    if exported:
        print("Exported:")
        for name in exported:
            print(name)
    else:
        print("No portraits were exported.")


if __name__ == "__main__":
    main()
