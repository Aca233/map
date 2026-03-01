#!/usr/bin/env python3
"""
快速扫描 Paradox/HOI4 .mesh 二进制里的属性 token。
仅用于逆向调试，不做最终转换。
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path


def is_ascii_name(data: bytes) -> bool:
    if not data:
        return False
    for b in data:
        if b < 0x20 or b > 0x7E:
            return False
    return True


def scan_props(blob: bytes):
    n = len(blob)
    i = 0
    found = []

    # 经验：HOI4 的 pdx 二进制通常以 @@b@ 开头
    if n >= 4 and blob[:4] == b"@@b@":
        i = 4

    while i < n - 8:
        if blob[i] != 0x21:  # '!'
            i += 1
            continue

        name_len = blob[i + 1]
        if not (1 <= name_len <= 63):
            i += 1
            continue

        name_start = i + 2
        name_end = name_start + name_len
        if name_end + 5 > n:
            i += 1
            continue

        name = blob[name_start:name_end]
        if not is_ascii_name(name):
            i += 1
            continue

        dtype_b = blob[name_end]
        dtype = chr(dtype_b)
        count = struct.unpack_from("<I", blob, name_end + 1)[0]

        elem_size = {
            "f": 4,  # float32
            "i": 4,  # int32
            "b": 1,  # byte
            "s": 1,  # byte-string / cstring block
        }.get(dtype)
        if elem_size is None:
            i += 1
            continue

        data_start = name_end + 5
        data_end = data_start + count * elem_size
        if data_end > n:
            i += 1
            continue

        found.append(
            {
                "offset": i,
                "name": name.decode("ascii", errors="replace"),
                "dtype": dtype,
                "count": count,
                "data_start": data_start,
                "data_end": data_end,
            }
        )

        # 命中后直接跳到 payload 末尾，避免在 payload 中重复误报
        i = data_end

    return found


def preview(blob: bytes, token: dict) -> str:
    ds, de = token["data_start"], token["data_end"]
    dt = token["dtype"]
    c = token["count"]

    if c == 0:
        return "[]"

    if dt == "f":
        k = min(c, 6)
        vals = struct.unpack_from("<" + "f" * k, blob, ds)
        return "[" + ", ".join(f"{v:.6g}" for v in vals) + (", ..." if c > k else "") + "]"

    if dt == "i":
        k = min(c, 8)
        vals = struct.unpack_from("<" + "i" * k, blob, ds)
        return "[" + ", ".join(str(v) for v in vals) + (", ..." if c > k else "") + "]"

    if dt in ("b", "s"):
        k = min(c, 16)
        vals = blob[ds : ds + k]
        hx = " ".join(f"{b:02x}" for b in vals)
        return hx + (" ..." if c > k else "")

    return "<unknown>"


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/scan_pdmesh.py <file.mesh>")
        return 1

    p = Path(sys.argv[1])
    if not p.exists():
        print(f"File not found: {p}")
        return 1

    blob = p.read_bytes()
    tokens = scan_props(blob)

    print(f"file: {p}")
    print(f"size: {len(blob)} bytes")
    print(f"tokens: {len(tokens)}")

    for t in tokens:
        print(
            f"@0x{t['offset']:08x}  !{t['name']}  {t['dtype']}[{t['count']}]  "
            f"data=0x{t['data_start']:08x}-0x{t['data_end']:08x}  "
            f"preview={preview(blob, t)}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
