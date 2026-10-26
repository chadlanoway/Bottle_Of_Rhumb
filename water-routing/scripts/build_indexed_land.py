"""Convert the global land shapefile into a spatially indexed GeoPackage."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

import pyogrio


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT_ROOT / "data" / "source" / "land_polygons.shp"
DEFAULT_OUTPUT = (
    PROJECT_ROOT / "data" / "source" / "land_polygons_indexed.gpkg"
)
LAYER_NAME = "land"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build an indexed GeoPackage for fast routing queries."
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--chunk-size", type=int, default=25_000)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def spatial_index_exists(path):
    with sqlite3.connect(path) as database:
        geometry_row = database.execute(
            "SELECT column_name FROM gpkg_geometry_columns "
            "WHERE table_name = ?",
            (LAYER_NAME,),
        ).fetchone()
        if not geometry_row:
            return False
        table = f"rtree_{LAYER_NAME}_{geometry_row[0]}"
        row = database.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        return row is not None


def main():
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not source.exists():
        raise FileNotFoundError(f"Source shapefile not found:\n{source}")
    if output.exists():
        if not args.overwrite:
            raise FileExistsError(
                f"Output already exists:\n{output}\n"
                "Use --overwrite only to intentionally rebuild it."
            )
        output.unlink()

    info = pyogrio.read_info(source)
    feature_count = int(info["features"])
    output.parent.mkdir(parents=True, exist_ok=True)
    print(f"Converting {feature_count:,} features in chunks...")

    written = 0
    first = True
    while written < feature_count:
        frame = pyogrio.read_dataframe(
            source,
            skip_features=written,
            max_features=args.chunk_size,
        )
        if frame.empty:
            break
        options = {"SPATIAL_INDEX": "YES"} if first else None
        pyogrio.write_dataframe(
            frame,
            output,
            layer=LAYER_NAME,
            driver="GPKG",
            append=not first,
            layer_options=options,
        )
        written += len(frame)
        first = False
        print(f"  {written:,} / {feature_count:,}", flush=True)

    if written != feature_count:
        raise RuntimeError(
            f"Expected {feature_count:,} features but wrote {written:,}."
        )
    if not spatial_index_exists(output):
        raise RuntimeError("GeoPackage was created without an RTree index.")
    print(f"Indexed GeoPackage created successfully:\n{output}")


if __name__ == "__main__":
    main()
