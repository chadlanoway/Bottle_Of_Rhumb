"""CLI wrapper for the adaptive SeaRoute/coastal-connector router."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pyproj import Geod


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.test_hybrid_searoute import calculate_hybrid  # noqa: E402


GEOD = Geod(ellps="WGS84")


def route_distance_kilometers(coordinates):
    total = 0.0
    for first, second in zip(coordinates, coordinates[1:]):
        _, _, meters = GEOD.inv(first[0], first[1], second[0], second[1])
        total += meters
    return round(total / 1000, 2)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", nargs=2, type=float, required=True)
    parser.add_argument("--end", nargs=2, type=float, required=True)
    parser.add_argument("--name", default="Water route")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--include-ports", action="store_true")
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    test = {
        "name": args.name,
        "start": list(args.start),
        "end": list(args.end),
        "include_ports": args.include_ports,
    }
    route = calculate_hybrid(test)
    properties = route.setdefault("properties", {})
    properties["featureType"] = "water-route"
    properties["routingEngine"] = "searoute-adaptive-hybrid"
    properties["distance_kilometers"] = route_distance_kilometers(
        route["geometry"]["coordinates"]
    )

    collection = {"type": "FeatureCollection", "features": [route]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output:
        json.dump(collection, output, indent=2)

    if properties.get("requiresManualAdjustment"):
        segments = ", ".join(properties.get("manualAdjustmentSegments", []))
        print(f"Route created with editable fallback: {segments}")
    else:
        print("Route created with automatic coastal connectors.")


if __name__ == "__main__":
    main()
