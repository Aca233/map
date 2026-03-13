from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


IDEOLOGIES = ("democratic", "fascism", "communism", "neutrality")


def export_flag(source_file: Path, output_file: Path) -> bool:
    if not source_file.exists():
        return False

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_file) as image:
        image.save(output_file, format="PNG")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Export HOI4 TGA flags to PNG assets.")
    parser.add_argument("--source-root", required=True, help="HOI4 gfx/flags directory")
    parser.add_argument("--output-dir", required=True, help="Output directory for PNG flags")
    parser.add_argument("tags", nargs="+", help="Country tags to export")
    args = parser.parse_args()

    source_root = Path(args.source_root)
    output_dir = Path(args.output_dir)

    exported: list[str] = []
    for raw_tag in args.tags:
        tag = raw_tag.upper()

        base_source = source_root / f"{tag}.tga"
        base_output = output_dir / f"{tag}.png"
        if export_flag(base_source, base_output):
            exported.append(base_output.name)

        for ideology in IDEOLOGIES:
            ideology_source = source_root / f"{tag}_{ideology}.tga"
            ideology_output = output_dir / f"{tag}_{ideology}.png"
            if export_flag(ideology_source, ideology_output):
                exported.append(ideology_output.name)

    if exported:
        print("Exported:")
        for name in exported:
            print(name)
    else:
        print("No flags were exported.")


if __name__ == "__main__":
    main()
