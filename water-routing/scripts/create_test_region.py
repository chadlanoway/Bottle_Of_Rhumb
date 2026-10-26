from pathlib import Path

import geopandas as gpd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = PROJECT_ROOT / "data" / "source" / "land_polygons.shp"
OUTPUT_FILE = PROJECT_ROOT / "data" / "processed" / "florida_keys_land.gpkg"

# west, south, east, north
FLORIDA_KEYS_BBOX = (-82.1, 24.2, -80.0, 25.9)


def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    if not SOURCE_FILE.exists():
        raise FileNotFoundError(
            f"Shapefile not found: {SOURCE_FILE}\n"
            "Update SOURCE_FILE if your shapefile has a different name."
        )

    print("Reading Florida Keys polygons from the global dataset...")

    land = gpd.read_file(
        SOURCE_FILE,
        bbox=FLORIDA_KEYS_BBOX,
        engine="pyogrio",
    )

    if land.empty:
        raise RuntimeError("No land polygons were found inside the test region.")

    print(f"Loaded {len(land):,} polygon features")
    print(f"Source CRS: {land.crs}")

    land = land[land.geometry.notna() & ~land.geometry.is_empty].copy()

    # Repair invalid polygons using Shapely's make-valid operation.
    invalid_count = (~land.geometry.is_valid).sum()
    print(f"Invalid geometries: {invalid_count:,}")

    if invalid_count:
        land.geometry = land.geometry.make_valid()

    # Keep only polygon geometry after repair.
    land = land[
        land.geometry.geom_type.isin(["Polygon", "MultiPolygon"])
    ].copy()

    land.to_file(
        OUTPUT_FILE,
        layer="land",
        driver="GPKG",
        engine="pyogrio",
    )

    print(f"Saved {len(land):,} features to:")
    print(OUTPUT_FILE)


if __name__ == "__main__":
    main()