# SeaRoute/MARNET proof-of-concept

This test is separate from the existing FastAPI water router. It does not
replace or modify the `/water-route` endpoint.

## 1. Copy the files

Copy these files into the existing `water-routing` project, preserving their
folders:

- `requirements-searoute-test.txt`
- `scripts/test_searoute_backbone.py`

## 2. Open PowerShell in the project

```powershell
cd C:\Users\lanak\OneDrive\Projects\Bottle_Of_Rhumb\water-routing
```

The virtual environment is optional, but using it keeps the test dependencies
inside the project. If activation shows the earlier Conda profile warning, call
the environment's Python executable directly in the following commands.

## 3. Install the test dependencies

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-searoute-test.txt
```

No account, API key, token, or separate network download is required. The
Python package contains the maritime network it uses.

## 4. Run the benchmarks

```powershell
.\.venv\Scripts\python.exe .\scripts\test_searoute_backbone.py
```

The first calculation includes one-time MARNET loading and graph construction,
so compare it with the later calculations rather than treating it as normal
per-request time.

## 5. Inspect the output

The script creates:

```text
data/processed/searoute_backbone_benchmarks.geojson
data/processed/searoute_backbone_report.json
```

Add the GeoJSON to QGIS. For every test, it contains:

- the MARNET route;
- the requested start and destination;
- the network start and network end selected by SeaRoute.

Inspect whether the network route crosses land, especially around Bergen,
Gothenburg, Vancouver, and Victoria. The JSON report shows the distance between
each requested endpoint and the maritime network. Those distances define how
much work the future local connector must perform.

## 6. Send back the results

Copy the PowerShell output and report the following:

- whether each route appears clear of land in QGIS;
- the start and destination connector gaps;
- whether Bergen and Gothenburg connect to useful network positions;
- the calculation times after the first route.

Do not add `append_orig_dest=True` yet. That option draws direct endpoint
segments without checking them against land, which could create false coastal
crossings.

