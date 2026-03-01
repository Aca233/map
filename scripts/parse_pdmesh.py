#!/usr/bin/env python3
"""
HOI4 / Paradox .mesh (pdxmesh / pdxasset) 基础解析器

目标：
1) 读取 .mesh 中的 token 化属性（!name + type + count + payload）
2) 提取可用于可视化的基础几何：
   - p   : 顶点位置 (float3)
   - n   : 顶点法线 (float3)
   - u0  : UV0 (float2)
   - tri : 索引 (int)
3) 导出：
   - JSON（完整解析结果）
   - OBJ（便于快速检查模型几何）

说明：
- 该脚本面向“能用”的逆向工程路径，不保证覆盖所有 Clausewitz 变体。
- 若某些模型解析失败，可先用 scripts/scan_pdmesh.py 看 token 分布再扩展规则。
"""

from __future__ import annotations

import argparse
import json
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any


TYPE_SIZE: Dict[str, int] = {
    "f": 4,  # float32
    "i": 4,  # int32
    "b": 1,  # byte
    "s": 1,  # byte string / index-like payload
}


@dataclass
class Token:
    offset: int
    name: str
    dtype: str
    count: int
    payload: bytes

    def as_floats(self) -> List[float]:
        if self.dtype != "f":
            raise TypeError(f"Token {self.name} is {self.dtype}, not float")
        if self.count == 0:
            return []
        return list(struct.unpack("<" + "f" * self.count, self.payload))

    def as_ints(self) -> List[int]:
        if self.dtype != "i":
            raise TypeError(f"Token {self.name} is {self.dtype}, not int")
        if self.count == 0:
            return []
        return list(struct.unpack("<" + "i" * self.count, self.payload))

    def as_bytes(self) -> List[int]:
        return list(self.payload)


@dataclass
class SubMesh:
    id: int
    lod: Optional[int] = None
    positions: List[List[float]] = field(default_factory=list)
    normals: List[List[float]] = field(default_factory=list)
    tangents: List[List[float]] = field(default_factory=list)
    uv0: List[List[float]] = field(default_factory=list)
    indices: List[int] = field(default_factory=list)
    bbox_min: Optional[List[float]] = None
    bbox_max: Optional[List[float]] = None
    material: Dict[str, Any] = field(default_factory=dict)

    @property
    def vertex_count(self) -> int:
        return len(self.positions)

    @property
    def triangle_count(self) -> int:
        return len(self.indices) // 3


# -----------------------------
# 低层 token 扫描
# -----------------------------


def _is_ascii_name(raw: bytes) -> bool:
    if not raw:
        return False
    for c in raw:
        # 避免把 '['/']' 误判进属性名
        if c < 0x20 or c > 0x7E or c in (0x5B, 0x5D):
            return False
    return True


def scan_tokens(blob: bytes) -> List[Token]:
    n = len(blob)
    i = 0
    tokens: List[Token] = []

    # 常见头：@@b@
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

        raw_name = blob[name_start:name_end]
        if not _is_ascii_name(raw_name):
            i += 1
            continue

        dtype = chr(blob[name_end])
        elem_size = TYPE_SIZE.get(dtype)
        if elem_size is None:
            i += 1
            continue

        count = struct.unpack_from("<I", blob, name_end + 1)[0]
        data_start = name_end + 5
        data_end = data_start + count * elem_size
        if data_end > n:
            i += 1
            continue

        token = Token(
            offset=i,
            name=raw_name.decode("ascii", errors="replace"),
            dtype=dtype,
            count=count,
            payload=blob[data_start:data_end],
        )
        tokens.append(token)

        # 命中后跳过 payload，降低误报
        i = data_end

    return tokens


# -----------------------------
# 几何提取
# -----------------------------


def _chunk(values: List[float], width: int) -> List[List[float]]:
    if width <= 0:
        return []
    usable = len(values) - (len(values) % width)
    return [values[i : i + width] for i in range(0, usable, width)]


def build_submeshes(tokens: List[Token]) -> List[SubMesh]:
    submeshes: List[SubMesh] = []
    current: Optional[SubMesh] = None
    pending_lod: Optional[int] = None

    def flush_current() -> None:
        nonlocal current
        if current is None:
            return
        if current.positions and current.indices:
            submeshes.append(current)
        current = None

    next_id = 0

    for tk in tokens:
        # lod 标识通常在每个 mesh 块前出现
        if tk.name == "lod" and tk.dtype == "i":
            vals = tk.as_ints()
            if vals:
                pending_lod = vals[0]
            continue

        # 新 submesh 以位置流 p(float) 开始
        if tk.name == "p" and tk.dtype == "f":
            flush_current()
            current = SubMesh(id=next_id, lod=pending_lod)
            next_id += 1
            current.positions = _chunk(tk.as_floats(), 3)
            continue

        # 还没进入 submesh，忽略非几何 token
        if current is None:
            continue

        # 法线：既可能是 n(float) 也可能是 n(s)（材质 normal map 引用）
        if tk.name == "n":
            if tk.dtype == "f":
                current.normals = _chunk(tk.as_floats(), 3)
            else:
                current.material["normalRef"] = tk.as_bytes()
            continue

        if tk.name == "ta" and tk.dtype == "f":
            # 通常是 float4 tangent
            current.tangents = _chunk(tk.as_floats(), 4)
            continue

        if tk.name == "u0" and tk.dtype == "f":
            current.uv0 = _chunk(tk.as_floats(), 2)
            continue

        if tk.name == "tri" and tk.dtype == "i":
            current.indices = tk.as_ints()
            continue

        if tk.name == "min" and tk.dtype == "f":
            vals = tk.as_floats()
            current.bbox_min = vals[:3] if len(vals) >= 3 else vals
            continue

        if tk.name == "max" and tk.dtype == "f":
            vals = tk.as_floats()
            current.bbox_max = vals[:3] if len(vals) >= 3 else vals
            continue

        # 材质相关弱引用（常见是 s[1]，像索引）
        if tk.name in ("shader", "diff", "spec"):
            current.material[tk.name] = tk.as_bytes()
            continue

    flush_current()
    return submeshes


# -----------------------------
# 导出
# -----------------------------


def write_obj(path: Path, submeshes: List[SubMesh]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    lines: List[str] = []
    lines.append("# Generated by parse_pdmesh.py")

    v_offset = 1
    vt_offset = 1
    vn_offset = 1

    for sm in submeshes:
        lod_txt = f"lod{sm.lod}" if sm.lod is not None else "lodNA"
        lines.append(f"o submesh_{sm.id}_{lod_txt}")

        for v in sm.positions:
            lines.append(f"v {v[0]:.9g} {v[1]:.9g} {v[2]:.9g}")

        has_uv = len(sm.uv0) == len(sm.positions) and len(sm.uv0) > 0
        has_n = len(sm.normals) == len(sm.positions) and len(sm.normals) > 0

        if has_uv:
            for uv in sm.uv0:
                lines.append(f"vt {uv[0]:.9g} {uv[1]:.9g}")

        if has_n:
            for n in sm.normals:
                lines.append(f"vn {n[0]:.9g} {n[1]:.9g} {n[2]:.9g}")

        tri_count = len(sm.indices) // 3
        for t in range(tri_count):
            i0 = sm.indices[t * 3 + 0] + v_offset
            i1 = sm.indices[t * 3 + 1] + v_offset
            i2 = sm.indices[t * 3 + 2] + v_offset

            if has_uv and has_n:
                t0 = sm.indices[t * 3 + 0] + vt_offset
                t1 = sm.indices[t * 3 + 1] + vt_offset
                t2 = sm.indices[t * 3 + 2] + vt_offset
                n0 = sm.indices[t * 3 + 0] + vn_offset
                n1 = sm.indices[t * 3 + 1] + vn_offset
                n2 = sm.indices[t * 3 + 2] + vn_offset
                lines.append(f"f {i0}/{t0}/{n0} {i1}/{t1}/{n1} {i2}/{t2}/{n2}")
            elif has_uv:
                t0 = sm.indices[t * 3 + 0] + vt_offset
                t1 = sm.indices[t * 3 + 1] + vt_offset
                t2 = sm.indices[t * 3 + 2] + vt_offset
                lines.append(f"f {i0}/{t0} {i1}/{t1} {i2}/{t2}")
            elif has_n:
                n0 = sm.indices[t * 3 + 0] + vn_offset
                n1 = sm.indices[t * 3 + 1] + vn_offset
                n2 = sm.indices[t * 3 + 2] + vn_offset
                lines.append(f"f {i0}//{n0} {i1}//{n1} {i2}//{n2}")
            else:
                lines.append(f"f {i0} {i1} {i2}")

        v_offset += len(sm.positions)
        if has_uv:
            vt_offset += len(sm.uv0)
        if has_n:
            vn_offset += len(sm.normals)

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_json(path: Path, source_mesh: Path, tokens: List[Token], submeshes: List[SubMesh]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "source": str(source_mesh),
        "tokenCount": len(tokens),
        "submeshCount": len(submeshes),
        "submeshes": [
            {
                "id": sm.id,
                "lod": sm.lod,
                "vertexCount": sm.vertex_count,
                "indexCount": len(sm.indices),
                "triangleCount": sm.triangle_count,
                "bbox": {
                    "min": sm.bbox_min,
                    "max": sm.bbox_max,
                },
                "material": sm.material,
                "positions": sm.positions,
                "normals": sm.normals,
                "uv0": sm.uv0,
                "indices": sm.indices,
            }
            for sm in submeshes
        ],
    }

    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# -----------------------------
# CLI
# -----------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse HOI4 .mesh and export JSON/OBJ")
    parser.add_argument("input", type=Path, help="Path to .mesh file")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("outputs/pdmesh"),
        help="Output directory (default: outputs/pdmesh)",
    )
    parser.add_argument("--obj", action="store_true", help="Export OBJ")
    parser.add_argument("--json", action="store_true", help="Export JSON")
    parser.add_argument("--lod", type=int, default=None, help="Only export specific LOD")

    args = parser.parse_args()

    if not args.input.exists():
        print(f"[ERR] File not found: {args.input}")
        return 1

    # 如果用户没显式指定，默认两种都导出
    export_obj = args.obj or (not args.obj and not args.json)
    export_json = args.json or (not args.obj and not args.json)

    blob = args.input.read_bytes()
    tokens = scan_tokens(blob)
    submeshes = build_submeshes(tokens)

    if args.lod is not None:
        submeshes = [sm for sm in submeshes if sm.lod == args.lod]

    if not submeshes:
        print("[WARN] No submeshes extracted.")
        print(f"       tokenCount={len(tokens)}")
        return 2

    print(f"[OK] tokenCount={len(tokens)} submeshCount={len(submeshes)}")
    for sm in submeshes:
        print(
            f"  - submesh#{sm.id} lod={sm.lod} "
            f"v={sm.vertex_count} i={len(sm.indices)} tri={sm.triangle_count}"
        )

    stem = args.input.stem
    if export_obj:
        obj_path = args.out_dir / f"{stem}.obj"
        write_obj(obj_path, submeshes)
        print(f"[OK] OBJ -> {obj_path}")

    if export_json:
        json_path = args.out_dir / f"{stem}.json"
        write_json(json_path, args.input, tokens, submeshes)
        print(f"[OK] JSON -> {json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
