"""Benchmark SeaRoute/MARNET before integrating it into the API.

This script does not modify the existing raster router. It calculates several
representative maritime routes, records endpoint-to-network gaps, and writes a
GeoJSON file for inspection in QGIS.
"""

from __future__ import annotations

import json
from pathlib import Path
from time import perf_counter

from pyproj import Geod
import searoute as sr


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = PROJECT_ROOT / "data" / "processed"
OUTPUT_GEOJSON = OUTPUT_DIRECTORY / "searoute_backbone_benchmarks.geojson"
OUTPUT_REPORT = OUTPUT_DIRECTORY / "searoute_backbone_report.json"
GEOD = Geod(ellps="WGS84")


TEST_ROUTES = (
    {
        "name": "Bergen to Gothenburg",
        "start": [5.320870647, 60.396650361],
        "end": [11.955056831, 57.711831379],
        "include_ports": True,
    },
    {
        "name": "Cuxhaven to Gothenburg",
        "start": [8.712223060, 53.871117994],
        "end": [11.955056831, 57.711831379],
        "include_ports": True,
    },
    {
        "name": "Vancouver to Victoria",
        "start": [-123.149935168, 49.282724366],
        "end": [-123.373128824, 48.424791069],
        "include_ports": True,
    },
    {
        "name": "New York offshore to Lisbon offshore",
        "start": [-73.7000, 40.3000],
        "end": [-9.7000, 38.5500],
        "include_ports": False,
    },
)


def distance_kilometers(first, second):
    _, _, meters = GEOD.inv(first[0], first[1], second[0], second[1])
    return meters / 1000


def feature_mapping(feature):
    interface = getattr(feature, "__geo_interface__", None)
    if interface is not None:
        return json.loads(json.dumps(interface))
    return json.loads(json.dumps(feature))


def point_feature(name, role, coordinates, route_name):
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "featureType": role,
            "routeName": route_name,
        },
        "geometry": {
            "type": "Point",
            "coordinates": coordinates,
        },
    }


def calculate_test_route(test):
    started = perf_counter()
    route = sr.searoute(
        test["start"],
        test["end"],
        units="km",
        append_orig_dest=False,
        backend="igraph",
    )
    seconds = perf_counter() - started
    feature = feature_mapping(route)
    coordinates = feature.get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2:
        raise RuntimeError(f"{test['name']} did not return a usable route.")

    network_start = coordinates[0]
    network_end = coordinates[-1]
    start_gap = distance_kilometers(test["start"], network_start)
    end_gap = distance_kilometers(network_end, test["end"])
    properties = feature.setdefault("properties", {})
    properties.update(
        {
            "name": test["name"],
            "featureType": "searoute-backbone",
            "calculationSeconds": round(seconds, 4),
            "requestedStart": test["start"],
            "requestedEnd": test["end"],
            "networkStart": network_start,
            "networkEnd": network_end,
            "startConnectorGapKm": round(start_gap, 3),
            "endConnectorGapKm": round(end_gap, 3),
        }
    )

    report = {
        "name": test["name"],
        "calculation_seconds": round(seconds, 4),
        "route_length_km": round(float(properties.get("length", 0)), 2),
        "start_connector_gap_km": round(start_gap, 3),
        "end_connector_gap_km": round(end_gap, 3),
        "route_vertices": len(coordinates),
        "requested_start": test["start"],
        "network_start": network_start,
        "requested_end": test["end"],
        "network_end": network_end,
    }
    features = [
        feature,
        point_feature(
            f"{test['name']} requested start",
            "requested-start",
            test["start"],
            test["name"],
        ),
        point_feature(
            f"{test['name']} network start",
            "network-start",
            network_start,
            test["name"],
        ),
        point_feature(
            f"{test['name']} network end",
            "network-end",
            network_end,
            test["name"],
        ),
        point_feature(
            f"{test['name']} requested destination",
            "requested-destination",
            test["end"],
            test["name"],
        ),
    ]
    return features, report


def main():
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    all_features = []
    reports = []

    print("Testing SeaRoute 1.6.0 with the igraph backend...")
    print("The first route includes one-time network loading time.\n")
    for test in TEST_ROUTES:
        try:
            features, report = calculate_test_route(test)
        except Exception as error:
            report = {
                "name": test["name"],
                "error": str(error),
            }
            print(f"FAILED  {test['name']}: {error}")
        else:
            all_features.extend(features)
            print(
                f"OK      {report['name']}\n"
                f"        {report['calculation_seconds']:.4f} seconds; "
                f"{report['route_length_km']:,.2f} km; "
                f"connector gaps "
                f"{report['start_connector_gap_km']:.2f} / "
                f"{report['end_connector_gap_km']:.2f} km"
            )
        reports.append(report)

    with OUTPUT_GEOJSON.open("w", encoding="utf-8") as output:
        json.dump(
            {"type": "FeatureCollection", "features": all_features},
            output,
            indent=2,
        )
    with OUTPUT_REPORT.open("w", encoding="utf-8") as output:
        json.dump(
            {
                "purpose": "SeaRoute/MARNET backbone feasibility test",
                "backend": "igraph",
                "append_requested_endpoints": False,
                "routes": reports,
            },
            output,
            indent=2,
        )

    print(f"\nGeoJSON: {OUTPUT_GEOJSON}")
    print(f"Report:  {OUTPUT_REPORT}")
    print("Open the GeoJSON in QGIS and inspect every coastline crossing.")


if __name__ == "__main__":
    main()
