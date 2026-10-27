import { MaplibreTerradrawControl } from '@watergis/maplibre-gl-terradraw';
import { TerraDrawSelectMode } from 'terra-draw';
import { Marker, Popup } from 'maplibre-gl';
import '@watergis/maplibre-gl-terradraw/dist/maplibre-gl-terradraw.css';

const EMPTY_COLLECTION = {
  type: 'FeatureCollection',
  features: [],
};

const LIVE_SEGMENT_SOURCE = 'bottle-of-rhumb-live-segment';
const LIVE_SEGMENT_CASING = 'bottle-of-rhumb-live-segment-casing';
const LIVE_SEGMENT_LINE = 'bottle-of-rhumb-live-segment-line';
const EARTH_RADIUS_METERS = 6371008.8;
const liveDrawingOverlays = new WeakMap();
const drawingInstructionOverlays = new WeakMap();
const TEXT_SOURCE = 'bottle-of-rhumb-text';
const FEATURE_LABEL_LAYER = 'bottle-of-rhumb-feature-labels';
const FREE_TEXT_LAYER = 'bottle-of-rhumb-free-text';
const MULTI_SELECT_SOURCE = 'bottle-of-rhumb-multi-selection';
const MULTI_SELECT_FILL = 'bottle-of-rhumb-multi-selection-fill';
const MULTI_SELECT_LINE = 'bottle-of-rhumb-multi-selection-line';
const MULTI_SELECT_POINT = 'bottle-of-rhumb-multi-selection-point';
const DASHED_LINE_LAYER = 'bottle-of-rhumb-dashed-lines';
const DOTTED_LINE_LAYER = 'bottle-of-rhumb-dotted-lines';
const DASHED_POLYGON_LAYER = 'bottle-of-rhumb-dashed-polygons';
const DOTTED_POLYGON_LAYER = 'bottle-of-rhumb-dotted-polygons';
const backgroundMarkerStates = new WeakMap();
const previewPopups = new WeakMap();
const selectionIntents = new WeakMap();
const QUICK_ROUTE_SOURCE = 'bottle-of-rhumb-quick-route-preview';
const QUICK_ROUTE_CASING = 'bottle-of-rhumb-quick-route-preview-casing';
const QUICK_ROUTE_LINE = 'bottle-of-rhumb-quick-route-preview-line';

export function createQuickRouteController(map, options = {}) {
  let active = false;
  let start = null;
  let previousCursor = '';

  const tooltip = document.createElement('div');
  tooltip.setAttribute('role', 'status');
  Object.assign(tooltip.style, {
    position: 'absolute',
    zIndex: '30',
    display: 'none',
    maxWidth: '230px',
    padding: '7px 10px',
    border: '1px solid rgba(255,255,255,.22)',
    borderRadius: '999px',
    background: '#172229',
    color: '#fff',
    boxShadow: '0 5px 18px rgba(0,0,0,.28)',
    font: '600 12px/1.25 Arial, Helvetica, sans-serif',
    pointerEvents: 'none',
    transform: 'translate(14px, 14px)',
    whiteSpace: 'nowrap',
  });
  map.getContainer().appendChild(tooltip);

  function ensurePreview() {
    if (!map.getSource(QUICK_ROUTE_SOURCE)) {
      map.addSource(QUICK_ROUTE_SOURCE, { type: 'geojson', data: EMPTY_COLLECTION });
    }
    if (!map.getLayer(QUICK_ROUTE_CASING)) {
      map.addLayer({
        id: QUICK_ROUTE_CASING,
        type: 'line',
        source: QUICK_ROUTE_SOURCE,
        paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 },
      });
    }
    if (!map.getLayer(QUICK_ROUTE_LINE)) {
      map.addLayer({
        id: QUICK_ROUTE_LINE,
        type: 'line',
        source: QUICK_ROUTE_SOURCE,
        paint: {
          'line-color': '#1e90ff',
          'line-width': 3,
          'line-dasharray': [2, 2],
        },
      });
    }
  }

  function setPreview(end) {
    const source = map.getSource(QUICK_ROUTE_SOURCE);
    if (!source) return;
    source.setData(start && end ? {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [start, end] },
    } : EMPTY_COLLECTION);
  }

  function setInstruction(message) {
    tooltip.textContent = message;
    options.onStatus?.(message);
  }

  function handleMouseMove(event) {
    if (!active) return;
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.point.x}px`;
    tooltip.style.top = `${event.point.y}px`;
    if (start) setPreview([event.lngLat.lng, event.lngLat.lat]);
  }

  function handleClick(event) {
    if (!active) return;
    const coordinate = [
      Number(event.lngLat.lng.toFixed(6)),
      Number(event.lngLat.lat.toFixed(6)),
    ];
    if (!start) {
      start = coordinate;
      setPreview(coordinate);
      setInstruction('Click the destination');
      return;
    }

    const routeStart = start;
    cancel();
    options.onComplete?.(routeStart, coordinate);
  }

  function handleKeyDown(event) {
    if (active && event.key === 'Escape') cancel();
  }

  function arm() {
    if (active) cancel();
    ensurePreview();
    active = true;
    start = null;
    previousCursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = 'crosshair';
    tooltip.style.display = 'none';
    setInstruction('Click the route’s starting point');
    options.onActiveChange?.(true);
  }

  function cancel() {
    if (!active) return;
    active = false;
    start = null;
    setPreview(null);
    tooltip.style.display = 'none';
    map.getCanvas().style.cursor = previousCursor;
    options.onStatus?.('');
    options.onActiveChange?.(false);
  }

  function destroy() {
    cancel();
    map.off('mousemove', handleMouseMove);
    map.off('click', handleClick);
    window.removeEventListener('keydown', handleKeyDown);
    tooltip.remove();
  }

  map.on('mousemove', handleMouseMove);
  map.on('click', handleClick);
  window.addEventListener('keydown', handleKeyDown);

  return { arm, cancel, destroy, get active() { return active; } };
}

export function setupDrawingTools(map, onChange, getActiveLayerId, onSelectionChange) {
  const draw = new MaplibreTerradrawControl({
    modes: ['point', 'linestring', 'polygon', 'circle', 'text', 'select'],
    modeOptions: {
      select: new TerraDrawSelectMode({
        flags: {
          linestring: {
            feature: {
              draggable: true,
              coordinates: {
                draggable: true,
                deletable: true,
                midpoints: {
                  draggable: true,
                },
              },
            },
          },
        },
      }),
    },
    open: true,
  });

  map.addControl(draw, 'top-right');

  const engine = draw.getTerraDrawInstance();
  ensureTextLayers(map);
  const keepNativeTextHidden = () => suppressNativeTextLayer(map);
  map.on('styledata', keepNativeTextHidden);
  map.once('remove', () => map.off('styledata', keepNativeTextHidden));
  ensureMultiSelectionLayers(map);
  ensureFeatureAppearance(map);
  keepPointLayersAbovePolygons(map);
  const pressedSelectionKeys = new Set();
  const selectionKeys = new Set(['Shift', 'Control', 'Meta']);
  const handleKeyDown = (event) => {
    if (selectionKeys.has(event.key)) pressedSelectionKeys.add(event.key);
  };
  const handleKeyUp = (event) => { pressedSelectionKeys.delete(event.key); };
  const clearSelectionKeys = () => { pressedSelectionKeys.clear(); };
  const isAdditiveSelection = () => pressedSelectionKeys.size > 0;
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', clearSelectionKeys);
  map.once('remove', () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', clearSelectionKeys);
  });
  backgroundMarkerStates.set(map, {
    engine,
    hiddenLayerIds: new Set(),
    markers: new Map(),
    onSelectionChange,
  });
  const reportChange = () => {
    const collection = getFeatureCollection(draw);
    updateTextSource(map, collection);
    onChange?.(collection);
  };

  engine?.on('finish', (id) => {
    const layerId = getActiveLayerId?.();
    const finishedFeature = engine.getSnapshot().find(
      (feature) => String(feature.id) === String(id),
    );
    if (layerId && id !== undefined) {
      engine.updateFeatureProperties(id, { layerId });
    }
    if (finishedFeature?.properties?.mode === 'text') {
      engine.updateFeatureProperties(id, {
        featureType: 'text',
        textFont: 'sans',
        textColor: '#172229',
        textSize: 16,
      });
    }
    onSelectionChange?.(id, { additive: false });
    reportChange();
    queueMicrotask(() => {
      if (!engine || engine.getMode() === 'select') return;
      engine.setMode('select');
      if (id !== null && id !== undefined) {
        try { engine.selectFeature(id); } catch { /* feature remains created */ }
      }
    });
  });
  engine?.on('change', reportChange);
  engine?.on('select', (id) => {
    const intendedAdditive = selectionIntents.get(draw);
    selectionIntents.delete(draw);
    onSelectionChange?.(id, {
      additive: intendedAdditive ?? isAdditiveSelection(),
    });
    reportChange();
  });
  engine?.on('deselect', () => {
    const intendedAdditive = selectionIntents.get(draw);
    if (!(intendedAdditive ?? isAdditiveSelection())) {
      onSelectionChange?.(null, { additive: false });
    }
    reportChange();
  });

  if (engine) {
    const liveOverlay = setupLiveDrawingOverlay(map, engine);
    liveDrawingOverlays.set(draw, liveOverlay);
    engine.on('finish', liveOverlay.clear);

    const instructionOverlay = setupDrawingInstructionOverlay(map, engine);
    drawingInstructionOverlays.set(draw, instructionOverlay);
    engine.on('finish', instructionOverlay.clear);
  }

  map.on('click', FREE_TEXT_LAYER, (event) => {
    const id = event.features?.[0]?.id;
    if (id === undefined) return;
    engine?.selectFeature(id);
  });
  map.on('mouseenter', FREE_TEXT_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', FREE_TEXT_LAYER, () => { map.getCanvas().style.cursor = ''; });

  // Terra Draw supplies the drawing engine. Bottle of Rhumb supplies its own UI.
  const engineButton = map
    .getContainer()
    .querySelector('[class*="maplibregl-terradraw"]');
  engineButton?.closest('.maplibregl-ctrl')?.classList.add('drawing-engine-control');

  reportChange();
  return draw;
}

export function startDrawing(draw, geometryType) {
  const modes = {
    point: 'point',
    line: 'linestring',
    polygon: 'polygon',
    circle: 'circle',
    text: 'text',
    select: 'select',
  };

  const engine = draw.getTerraDrawInstance();
  liveDrawingOverlays.get(draw)?.clear();
  drawingInstructionOverlays.get(draw)?.clear();

  const mode = modes[geometryType];
  if (!mode) throw new Error(`Unknown drawing type: ${geometryType}`);
  engine?.setMode(mode);
}

function setupDrawingInstructionOverlay(map, engine) {
  const tooltip = document.createElement('div');
  tooltip.className = 'drawing-instruction-tooltip';
  tooltip.setAttribute('role', 'status');
  Object.assign(tooltip.style, {
    position: 'absolute',
    zIndex: '30',
    display: 'none',
    maxWidth: '290px',
    padding: '7px 10px',
    border: '1px solid rgba(255,255,255,.22)',
    borderRadius: '999px',
    background: '#172229',
    color: '#fff',
    boxShadow: '0 5px 18px rgba(0,0,0,.28)',
    font: '600 12px/1.25 Arial, Helvetica, sans-serif',
    pointerEvents: 'none',
    transform: 'translate(14px, 14px)',
    whiteSpace: 'nowrap',
  });
  map.getContainer().appendChild(tooltip);

  const clear = () => {
    tooltip.style.display = 'none';
  };

  const getInstruction = () => {
    const mode = engine.getMode();
    const snapshot = engine.getSnapshot();
    const drawingFeature = snapshot.find(
      (feature) =>
        feature.properties?.mode === mode &&
        feature.properties?.currentlyDrawing === true,
    );

    if (mode === 'point') return 'Click the map to place a point';
    if (mode === 'text') return 'Click the map to place text';
    if (mode === 'circle') return 'Click once, then move mouse to draw a circle';

    if (mode === 'linestring') {
      return drawingFeature
        ? 'Click to add a vertex · Double-click to finish'
        : 'Click the map to start a line';
    }

    if (mode === 'polygon') {
      return drawingFeature
        ? 'Click to add a vertex · Double-click to finish'
        : 'Click the map to start a polygon';
    }

    return '';
  };

  const update = (event) => {
    const message = getInstruction();
    if (!message) {
      clear();
      return;
    }

    tooltip.textContent = message;
    tooltip.style.left = `${event.point.x}px`;
    tooltip.style.top = `${event.point.y}px`;
    tooltip.style.display = 'block';
  };

  map.on('mousemove', update);
  map.on('mouseout', clear);
  map.once('remove', () => {
    map.off('mousemove', update);
    map.off('mouseout', clear);
    tooltip.remove();
  });

  return { clear };
}

export function deleteSelected(draw) {
  const engine = draw?.getTerraDrawInstance();
  const selectedIds = (draw?.getFeatures(true)?.features ?? []).map(
    (feature) => feature.id,
  );

  if (selectedIds.length > 0) engine?.removeFeatures(selectedIds);
}

export function deleteFeature(draw, id) {
  if (id === null || id === undefined) return;
  draw?.getTerraDrawInstance()?.removeFeatures([id]);
}

export function deleteFeatures(draw, ids) {
  const validIds = (ids ?? []).filter((id) => id !== null && id !== undefined);
  if (validIds.length > 0) draw?.getTerraDrawInstance()?.removeFeatures(validIds);
}

export function deleteLayerFeatures(draw, layerId) {
  const engine = draw?.getTerraDrawInstance();
  if (!engine) return;

  const ids = engine
    .getSnapshot()
    .filter((feature) => feature.properties?.layerId === layerId)
    .map((feature) => feature.id);

  if (ids.length > 0) engine.removeFeatures(ids);
}

export function selectFeature(draw, id, { additive } = {}) {
  if (typeof additive === 'boolean') selectionIntents.set(draw, additive);
  draw?.getTerraDrawInstance()?.selectFeature(id);
  queueMicrotask(() => selectionIntents.delete(draw));
}

export function updateFeature(draw, id, properties) {
  const engine = draw?.getTerraDrawInstance();
  engine?.updateFeatureProperties(id, properties);
}

export function previewFeaturePopup(draw, map, id, styleDefaults = {}) {
  if (!draw || !map || id === null || id === undefined) return;
  const feature = draw.getTerraDrawInstance()?.getSnapshot().find(
    (candidate) => String(candidate.id) === String(id),
  );
  if (!feature?.properties?.popupEnabled) return;

  previewPopups.get(map)?.remove();
  const popup = new Popup({ closeButton: true, closeOnClick: false, maxWidth: '420px' })
    .setLngLat(popupCoordinates(feature, map))
    .setDOMContent(buildPopupElement(feature.properties))
    .addTo(map);
  applyPopupStyle(popup, feature.properties, styleDefaults);
  previewPopups.set(map, popup);
}

export function setupViewerFeatureInteractions(draw, map, getStyleDefaults) {
  // Keep thin routes and small points easy to use without changing their
  // visible styling. This produces a 28 px square hit target around the mouse.
  const hitRadius = 14;
  const hitLayerIds = [
    'td-point',
    'td-point-marker',
    'td-linestring',
    'td-polygon',
    'td-polygon-outline',
    DASHED_LINE_LAYER,
    DOTTED_LINE_LAYER,
    DASHED_POLYGON_LAYER,
    DOTTED_POLYGON_LAYER,
    FEATURE_LABEL_LAYER,
    FREE_TEXT_LAYER,
  ];

  const popupFeatureAt = (point) => {
    const layers = hitLayerIds.filter((layerId) => map.getLayer(layerId));
    if (layers.length === 0) return null;

    const rendered = map.queryRenderedFeatures(
      [
        [point.x - hitRadius, point.y - hitRadius],
        [point.x + hitRadius, point.y + hitRadius],
      ],
      { layers },
    );
    const snapshot = draw?.getTerraDrawInstance()?.getSnapshot() ?? [];

    for (const renderedFeature of rendered) {
      const renderedId = renderedFeature.id ?? renderedFeature.properties?.id;
      if (renderedId === null || renderedId === undefined) continue;
      const feature = snapshot.find(
        (candidate) => String(candidate.id) === String(renderedId),
      );
      if (feature?.properties?.popupEnabled) return feature;
    }

    // Some restored Terra Draw features do not preserve the rendered source
    // ID in the form returned by queryRenderedFeatures. Fall back to a direct
    // screen-pixel geometry test so saved points and thin lines remain easy to
    // click and still receive the pointer cursor.
    if (rendered.length > 0) {
      let closest = null;
      let closestDistance = Infinity;
      for (const feature of snapshot) {
        if (!feature?.properties?.popupEnabled) continue;
        const distance = featureScreenDistance(map, feature, point);
        if (distance < closestDistance) {
          closest = feature;
          closestDistance = distance;
        }
      }
      if (closest && closestDistance <= hitRadius) return closest;
    }

    return null;
  };

  const handleMouseMove = (event) => {
    map.getCanvas().style.cursor = popupFeatureAt(event.point) ? 'pointer' : '';
  };
  const handleMouseLeave = () => {
    map.getCanvas().style.cursor = '';
  };
  const handleClick = (event) => {
    const feature = popupFeatureAt(event.point);
    if (!feature) return;
    previewFeaturePopup(draw, map, feature.id, getStyleDefaults?.() ?? {});
  };

  map.on('mousemove', handleMouseMove);
  map.on('mouseout', handleMouseLeave);
  map.on('click', handleClick);

  const destroy = () => {
    map.off('mousemove', handleMouseMove);
    map.off('mouseout', handleMouseLeave);
    map.off('click', handleClick);
    map.getCanvas().style.cursor = '';
  };
  map.once('remove', destroy);
  return destroy;
}

function featureScreenDistance(map, feature, point) {
  const geometry = feature?.geometry;
  if (!geometry) return Infinity;

  if (geometry.type === 'Point') {
    return screenPointDistance(point, projectCoordinate(map, geometry.coordinates));
  }
  if (geometry.type === 'MultiPoint') {
    return minimumDistance(geometry.coordinates, (coordinate) => (
      screenPointDistance(point, projectCoordinate(map, coordinate))
    ));
  }
  if (geometry.type === 'LineString') {
    return screenLineDistance(map, point, geometry.coordinates);
  }
  if (geometry.type === 'MultiLineString') {
    return minimumDistance(geometry.coordinates, (line) => (
      screenLineDistance(map, point, line)
    ));
  }
  if (geometry.type === 'Polygon') {
    return screenPolygonDistance(map, point, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return minimumDistance(geometry.coordinates, (polygon) => (
      screenPolygonDistance(map, point, polygon)
    ));
  }
  return Infinity;
}

function screenPolygonDistance(map, point, rings) {
  if (!Array.isArray(rings) || rings.length === 0) return Infinity;
  const projectedRings = rings.map((ring) => (
    ring.map((coordinate) => projectCoordinate(map, coordinate)).filter(Boolean)
  ));
  if (projectedRings[0]?.length >= 3 && pointInScreenRing(point, projectedRings[0])) {
    const insideHole = projectedRings.slice(1).some(
      (ring) => ring.length >= 3 && pointInScreenRing(point, ring),
    );
    if (!insideHole) return 0;
  }
  return minimumDistance(projectedRings, (ring) => screenPathDistance(point, ring));
}

function screenLineDistance(map, point, coordinates) {
  const projected = (coordinates ?? [])
    .map((coordinate) => projectCoordinate(map, coordinate))
    .filter(Boolean);
  return screenPathDistance(point, projected);
}

function screenPathDistance(point, path) {
  if (path.length === 1) return screenPointDistance(point, path[0]);
  let distance = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    distance = Math.min(
      distance,
      pointToScreenSegmentDistance(point, path[index - 1], path[index]),
    );
  }
  return distance;
}

function pointToScreenSegmentDistance(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return screenPointDistance(point, start);
  const amount = Math.max(0, Math.min(1, (
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
  )));
  return screenPointDistance(point, {
    x: start.x + amount * deltaX,
    y: start.y + amount * deltaY,
  });
}

function pointInScreenRing(point, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const first = ring[current];
    const second = ring[previous];
    const crosses = ((first.y > point.y) !== (second.y > point.y))
      && point.x < ((second.x - first.x) * (point.y - first.y))
      / ((second.y - first.y) || Number.EPSILON) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function projectCoordinate(map, coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return null;
  return map.project(coordinate);
}

function screenPointDistance(first, second) {
  if (!second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function minimumDistance(values, getDistance) {
  let distance = Infinity;
  for (const value of values ?? []) distance = Math.min(distance, getDistance(value));
  return distance;
}

export function setHiddenLayers(draw, map, hiddenLayerIds) {
  if (!draw || !map) return;

  const hidden = [
    'in',
    ['coalesce', ['get', 'layerId'], 'default-layer'],
    ['literal', hiddenLayerIds],
  ];
  const filter = ['!', hidden];

  if (map.getLayer('td-linestring')) {
    map.setFilter('td-linestring', ['all', filter, solidFeatureFilter()]);
  }
  if (map.getLayer('td-polygon')) map.setFilter('td-polygon', filter);
  if (map.getLayer('td-polygon-outline')) {
    map.setFilter('td-polygon-outline', ['all', filter, solidFeatureFilter()]);
  }
  for (const [layerId, geometryType, dash] of [
    [DASHED_LINE_LAYER, 'LineString', 'dashed'],
    [DOTTED_LINE_LAYER, 'LineString', 'dotted'],
    [DASHED_POLYGON_LAYER, 'Polygon', 'dashed'],
    [DOTTED_POLYGON_LAYER, 'Polygon', 'dotted'],
  ]) {
    if (map.getLayer(layerId)) {
      map.setFilter(layerId, ['all', filter, ['==', ['geometry-type'], geometryType], ['==', ['get', 'featureDash'], dash]]);
    }
  }

  const pointFilter = ['all', filter, [
    'any',
    ['!=', ['get', 'featureType'], 'text'],
    ['==', ['get', 'selected'], true],
  ]];
  if (map.getLayer('td-point')) map.setFilter('td-point', pointFilter);
  if (map.getLayer('td-point-marker')) {
    map.setFilter('td-point-marker', [
      'all',
      pointFilter,
      ['has', 'markerId'],
      ['!=', ['get', 'markerId'], null],
    ]);
  }

  if (map.getLayer(FEATURE_LABEL_LAYER)) {
    map.setFilter(FEATURE_LABEL_LAYER, ['all', filter, featureLabelFilter()]);
  }
  if (map.getLayer(FREE_TEXT_LAYER)) {
    map.setFilter(FREE_TEXT_LAYER, ['all', filter, freeTextFilter()]);
  }

  const markerState = backgroundMarkerStates.get(map);
  if (markerState) {
    markerState.hiddenLayerIds = new Set(hiddenLayerIds);
    updateBackgroundMarkerVisibility(markerState);
  }
}

export function setMultiSelectedFeatures(map, features, selectedIds) {
  const source = map?.getSource(MULTI_SELECT_SOURCE);
  if (!source) return;
  const selected = new Set((selectedIds ?? []).map(String));
  source.setData({
    type: 'FeatureCollection',
    features: (features ?? []).filter((feature) => selected.has(String(feature.id))),
  });
}

export function exportGeoJSON(draw, filename = 'bottle-of-rhumb-map.geojson') {
  const collection = getFeatureCollection(draw);
  const blob = new Blob([JSON.stringify(collection, null, 2)], {
    type: 'application/geo+json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

export function addGeoJSON(draw, map, collection, layerId) {
  validateGeoJSON(collection);
  const engine = draw.getTerraDrawInstance();
  const supportedFeatures = prepareFeatures(engine, collection, layerId, true);
  engine.addFeatures(supportedFeatures);
  fitMapToCollection(map, collection);
  return getFeatureCollection(draw);
}

export function replaceGeoJSON(draw, map, collection, fallbackLayerId) {
  validateGeoJSON(collection);
  const engine = draw.getTerraDrawInstance();
  const supportedFeatures = prepareFeatures(engine, collection, fallbackLayerId, false);
  engine.clear();
  engine.addFeatures(supportedFeatures);
  fitMapToCollection(map, collection);
  return getFeatureCollection(draw);
}

export function restoreGeoJSON(draw, collection, fallbackLayerId = 'default-layer') {
  validateGeoJSON(collection);
  const engine = draw.getTerraDrawInstance();
  const supportedFeatures = prepareFeatures(engine, collection, fallbackLayerId, false);
  if (supportedFeatures.length > 0) engine.addFeatures(supportedFeatures);
  return getFeatureCollection(draw);
}

export function addDerivedGeoJSON(draw, collection, layerId) {
  validateGeoJSON(collection);
  const engine = draw?.getTerraDrawInstance();
  if (!engine) throw new Error('Drawing tools are not ready.');
  const prepared = prepareFeatures(engine, collection, layerId, true);
  if (prepared.length === 0) throw new Error('The operation did not create any features.');
  const validations = engine.addFeatures(prepared);
  const failures = validations.filter((validation) => !validation.valid);
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.reason ?? 'Feature was rejected.').join(' '));
  }
  return {
    collection: getFeatureCollection(draw),
    addedIds: validations.map((validation) => validation.id).filter((id) => id !== undefined),
  };
}

function ensureFeatureAppearance(map) {
  const color = [
    'case',
    ['==', ['get', 'selected'], true],
    '#ffd166',
    ['coalesce', ['get', 'featureColor'], '#1e90ff'],
  ];
  const opacity = ['/', ['coalesce', ['get', 'featureOpacity'], 100], 100];
  const lineWidth = [
    '+',
    ['coalesce', ['get', 'featureSize'], 3],
    ['case', ['==', ['get', 'selected'], true], 2, 0],
  ];

  setPaint(map, 'td-linestring', 'line-color', color);
  setPaint(map, 'td-linestring', 'line-width', lineWidth);
  setPaint(map, 'td-linestring', 'line-opacity', opacity);
  setPaint(map, 'td-polygon-outline', 'line-color', color);
  setPaint(map, 'td-polygon-outline', 'line-width', lineWidth);
  setPaint(map, 'td-polygon-outline', 'line-opacity', opacity);
  setPaint(map, 'td-polygon', 'fill-color', color);
  setPaint(map, 'td-polygon', 'fill-opacity', ['*', opacity, 0.32]);
  setPaint(map, 'td-point', 'circle-color', color);
  setPaint(map, 'td-point', 'circle-radius', [
    '+',
    ['coalesce', ['get', 'featureSize'], 6],
    ['case', ['==', ['get', 'selected'], true], 2, 0],
  ]);
  setPaint(map, 'td-point', 'circle-opacity', opacity);
  setPaint(map, 'td-point', 'circle-stroke-color', '#ffffff');
  setPaint(map, 'td-point', 'circle-stroke-width', 2);
  setPaint(map, 'td-point', 'circle-stroke-opacity', opacity);

  const source = map.getStyle().layers.find((layer) => layer.id === 'td-linestring')?.source;
  if (!source) return;
  const beforeId = map.getLayer(FEATURE_LABEL_LAYER) ? FEATURE_LABEL_LAYER : undefined;
  addDashLayer(map, DASHED_LINE_LAYER, source, 'LineString', 'dashed', [2, 2], color, opacity, lineWidth, beforeId);
  addDashLayer(map, DOTTED_LINE_LAYER, source, 'LineString', 'dotted', [0.25, 1.8], color, opacity, lineWidth, beforeId);
  addDashLayer(map, DASHED_POLYGON_LAYER, source, 'Polygon', 'dashed', [2, 2], color, opacity, lineWidth, beforeId);
  addDashLayer(map, DOTTED_POLYGON_LAYER, source, 'Polygon', 'dotted', [0.25, 1.8], color, opacity, lineWidth, beforeId);
}

function addDashLayer(map, id, source, geometryType, dash, dashArray, color, opacity, width, beforeId) {
  if (map.getLayer(id)) return;
  map.addLayer({
    id,
    type: 'line',
    source,
    filter: ['all', ['==', ['geometry-type'], geometryType], ['==', ['get', 'featureDash'], dash]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': color,
      'line-width': width,
      'line-opacity': opacity,
      'line-dasharray': dashArray,
    },
  }, beforeId);
}

function solidFeatureFilter() {
  return ['!', ['in', ['coalesce', ['get', 'featureDash'], 'solid'], ['literal', ['dashed', 'dotted']]]];
}

function setPaint(map, layerId, property, value) {
  if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
}

function keepPointLayersAbovePolygons(map) {
  const labelAnchor = map.getLayer(FEATURE_LABEL_LAYER) ? FEATURE_LABEL_LAYER : undefined;
  for (const layerId of ['td-point', 'td-point-marker']) {
    if (map.getLayer(layerId)) map.moveLayer(layerId, labelAnchor);
  }
}

function ensureMultiSelectionLayers(map) {
  if (!map.getSource(MULTI_SELECT_SOURCE)) {
    map.addSource(MULTI_SELECT_SOURCE, { type: 'geojson', data: EMPTY_COLLECTION });
  }
  if (!map.getLayer(MULTI_SELECT_FILL)) {
    map.addLayer({
      id: MULTI_SELECT_FILL,
      type: 'fill',
      source: MULTI_SELECT_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#ffd166', 'fill-opacity': 0.14 },
    });
  }
  if (!map.getLayer(MULTI_SELECT_LINE)) {
    map.addLayer({
      id: MULTI_SELECT_LINE,
      type: 'line',
      source: MULTI_SELECT_SOURCE,
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
      paint: { 'line-color': '#ffd166', 'line-width': 4, 'line-opacity': 0.95 },
    });
  }
  if (!map.getLayer(MULTI_SELECT_POINT)) {
    map.addLayer({
      id: MULTI_SELECT_POINT,
      type: 'circle',
      source: MULTI_SELECT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 9,
        'circle-color': '#ffd166',
        'circle-opacity': 0.28,
        'circle-stroke-color': '#ffd166',
        'circle-stroke-width': 3,
      },
    });
  }
}

function prepareFeatures(engine, collection, layerId, forceLayerId) {
  return collection.features.map((feature) => {
    const mode = feature.properties?.featureType === 'text'
      ? 'text'
      : geometryMode(feature.geometry.type);

    return {
      ...feature,
      id: forceLayerId ? engine.getFeatureId() : feature.id ?? engine.getFeatureId(),
      properties: {
        ...feature.properties,
        layerId: forceLayerId ? layerId : feature.properties?.layerId ?? layerId,
        mode,
      },
    };
  });
}

export function validateGeoJSON(collection) {
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('GeoJSON must be a FeatureCollection with a features array.');
  }

  collection.features.forEach((feature, index) => {
    if (!feature || feature.type !== 'Feature') {
      throw new Error(`Feature ${index + 1} is not a valid GeoJSON Feature.`);
    }
    const geometryType = feature.geometry?.type;
    if (!geometryMode(geometryType)) {
      throw new Error(`Feature ${index + 1} uses unsupported geometry type ${geometryType ?? 'unknown'}.`);
    }
    validateCoordinates(feature.geometry.coordinates, index + 1);
  });

  return collection;
}

function validateCoordinates(value, featureNumber) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Feature ${featureNumber} has missing or invalid coordinates.`);
  }
  if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
      throw new Error(`Feature ${featureNumber} contains coordinates outside valid longitude/latitude ranges.`);
    }
    return;
  }
  for (const child of value) validateCoordinates(child, featureNumber);
}

function getFeatureCollection(draw) {
  const collection = draw?.getFeatures() ?? EMPTY_COLLECTION;

  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      properties: cleanProperties(feature.properties),
    })),
  };
}

function cleanProperties(properties = {}) {
  const cleaned = { ...properties };
  delete cleaned.mode;
  delete cleaned.selected;
  delete cleaned.currentlyDrawing;
  return cleaned;
}

function geometryMode(geometryType) {
  return {
    Point: 'point',
    LineString: 'linestring',
    Polygon: 'polygon',
  }[geometryType];
}

function ensureTextLayers(map) {
  if (!map.getSource(TEXT_SOURCE)) {
    map.addSource(TEXT_SOURCE, { type: 'geojson', data: EMPTY_COLLECTION });
  }

  const fontExpression = [
    'match', ['coalesce', ['get', 'textFont'], 'sans'],
    'serif', ['literal', ['Noto Serif Regular']],
    'mono', ['literal', ['Noto Sans Mono Regular']],
    ['literal', ['Noto Sans Regular']],
  ];
  const commonLayout = {
    'text-font': fontExpression,
    'text-size': ['coalesce', ['get', 'textSize'], 16],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  };
  const commonPaint = {
    'text-color': ['coalesce', ['get', 'textColor'], '#172229'],
    'text-halo-color': 'rgba(255,255,255,0.88)',
    'text-halo-width': 1.2,
  };

  map.addLayer({
    id: FEATURE_LABEL_LAYER,
    type: 'symbol',
    source: TEXT_SOURCE,
    filter: featureLabelFilter(),
    layout: { ...commonLayout, 'text-field': ['coalesce', ['get', 'labelText'], ['get', 'name'], ''] },
    paint: commonPaint,
  });

  map.addLayer({
    id: FREE_TEXT_LAYER,
    type: 'symbol',
    source: TEXT_SOURCE,
    filter: freeTextFilter(),
    layout: { ...commonLayout, 'text-field': ['coalesce', ['get', 'text'], 'Text'] },
    paint: commonPaint,
  });
}

function updateTextSource(map, collection) {
  map.getSource(TEXT_SOURCE)?.setData(collection);
  syncBackgroundMarkers(map, collection);
  suppressNativeTextLayer(map);
}

function featureLabelFilter() {
  return ['all', ['==', ['get', 'labelEnabled'], true], ['!=', ['get', 'featureType'], 'text'], ['!=', ['get', 'textBackground'], true]];
}

function freeTextFilter() {
  return ['all', ['==', ['get', 'featureType'], 'text'], ['!=', ['get', 'textBackground'], true]];
}

function hideNativeTextLayer(map) {
  if (
    map.getLayer('td-text-labels')
    && map.getLayoutProperty('td-text-labels', 'visibility') !== 'none'
  ) {
    map.setLayoutProperty('td-text-labels', 'visibility', 'none');
  }
}

function suppressNativeTextLayer(map) {
  hideNativeTextLayer(map);
  queueMicrotask(() => hideNativeTextLayer(map));
  requestAnimationFrame(() => hideNativeTextLayer(map));
  setTimeout(() => hideNativeTextLayer(map), 50);
  setTimeout(() => hideNativeTextLayer(map), 250);
}

function syncBackgroundMarkers(map, collection) {
  const state = backgroundMarkerStates.get(map);
  if (!state) return;

  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();

  for (const feature of collection.features) {
    const properties = feature.properties ?? {};
    const isFreeText = properties.featureType === 'text';
    const isFeatureLabel = properties.labelEnabled === true && !isFreeText;
    if (properties.textBackground !== true || (!isFreeText && !isFeatureLabel)) continue;

    const coordinates = labelCoordinates(feature.geometry);
    if (!coordinates) continue;

    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'map-text-background-marker';
    element.textContent = isFreeText
      ? properties.text || 'Text'
      : properties.labelText || properties.name || '';
    element.style.color = properties.textColor ?? '#172229';
    element.style.fontSize = `${properties.textSize ?? 16}px`;
    element.style.fontFamily = cssFontFamily(properties.textFont);
    element.style.backgroundColor = properties.backgroundColor ?? '#ffffff';
    element.style.borderRadius = properties.backgroundRounded === false ? '0' : '7px';
    element.style.boxShadow = properties.backgroundShadow === false
      ? 'none'
      : '0 3px 10px rgba(0, 0, 0, 0.32)';
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      state.engine.selectFeature(feature.id);
    });

    const marker = new Marker({ element, anchor: 'center' })
      .setLngLat(coordinates)
      .addTo(map);
    state.markers.set(String(feature.id), marker);
  }

  updateBackgroundMarkerVisibility(state, collection);
}

function updateBackgroundMarkerVisibility(state, collection) {
  for (const [id, marker] of state.markers) {
    const feature = collection?.features.find((candidate) => String(candidate.id) === id)
      ?? state.engine.getSnapshot().find((candidate) => String(candidate.id) === id);
    const hidden = state.hiddenLayerIds.has(feature?.properties?.layerId);
    marker.getElement().style.display = hidden ? 'none' : '';
  }
}

function labelCoordinates(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;

  const coordinates = geometry.type === 'Polygon'
    ? geometry.coordinates?.[0]
    : geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  const valid = coordinates.filter((coordinate) => (
    Array.isArray(coordinate) && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])
  ));
  if (valid.length === 0) return null;

  const total = valid.reduce(
    (sum, coordinate) => [sum[0] + coordinate[0], sum[1] + coordinate[1]],
    [0, 0],
  );
  return [total[0] / valid.length, total[1] / valid.length];
}

function cssFontFamily(font) {
  if (font === 'serif') return 'Georgia, serif';
  if (font === 'mono') return 'Consolas, monospace';
  return 'Arial, sans-serif';
}

function popupCoordinates(feature, map) {
  return labelCoordinates(feature.geometry) ?? [map.getCenter().lng, map.getCenter().lat];
}

function buildPopupElement(properties) {
  const container = document.createElement('article');
  container.className = 'feature-popup-content';

  const title = properties.popupTitle || properties.name;
  if (title) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    container.appendChild(heading);
  }

  const description = properties.popupDescription || properties.description;

  if (isSafeImageUrl(properties.popupImageUrl)) {
    const figure = document.createElement('figure');
    figure.className = 'feature-popup-image';
    const image = document.createElement('img');
    image.src = properties.popupImageUrl;
    image.alt = properties.popupImageAlt || '';
    image.loading = 'lazy';
    figure.appendChild(image);

    if (properties.popupImageCaption) {
      const caption = document.createElement('figcaption');
      caption.textContent = properties.popupImageCaption;
      figure.appendChild(caption);
    }

    container.appendChild(figure);
  }

  const youtubeEmbedUrl = getYouTubeEmbedUrl(properties.popupYouTubeUrl);
  if (youtubeEmbedUrl) {
    const video = document.createElement('div');
    video.className = 'feature-popup-youtube';
    const iframe = document.createElement('iframe');
    iframe.src = youtubeEmbedUrl;
    iframe.title = title ? `${title} video` : 'YouTube video';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-presentation';
    video.appendChild(iframe);
    container.appendChild(video);
  }

  if (description) {
    const paragraph = document.createElement('p');
    paragraph.textContent = description;
    container.appendChild(paragraph);
  }

  const fields = Array.isArray(properties.popupFields) ? properties.popupFields : [];
  if (fields.length > 0) {
    const list = document.createElement('dl');
    for (const key of fields) {
      if (properties[key] === undefined) continue;
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = key;
      value.textContent = formatPopupValue(properties[key]);
      row.append(term, value);
      list.appendChild(row);
    }
    if (list.children.length > 0) container.appendChild(list);
  }

  return container;
}

function getYouTubeEmbedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = null;
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || null;
    } else if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      videoId = url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1] || null;
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId || '')) return null;
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
    embed.searchParams.set('controls', '1');
    embed.searchParams.set('playsinline', '1');
    embed.searchParams.set('rel', '0');
    return embed.toString();
  } catch {
    return null;
  }
}

function applyPopupStyle(popup, properties, defaults) {
  const backgroundColor = properties.popupBackgroundColor ?? defaults.backgroundColor ?? '#172229';
  const opacity = properties.popupBackgroundOpacity ?? defaults.backgroundOpacity ?? 90;
  const textColor = properties.popupTextColor ?? defaults.textColor ?? '#ffffff';
  const fontFamily = properties.popupFontFamily ?? defaults.fontFamily ?? 'sans';
  const glowEnabled = properties.popupGlowEnabled ?? defaults.glowEnabled ?? false;
  const glowColor = properties.popupGlowColor ?? defaults.glowColor ?? '#1e90ff';
  const glowSize = properties.popupGlowSize ?? defaults.glowSize ?? 18;
  const background = hexToRgba(backgroundColor, Number(opacity) / 100);
  const element = popup.getElement();
  const content = element?.querySelector('.maplibregl-popup-content');
  if (!element || !content) return;

  element.classList.add('feature-styled-popup');
  element.classList.toggle('has-popup-glow', Boolean(glowEnabled));
  element.style.setProperty('--feature-popup-background', background);
  element.style.setProperty('--feature-popup-glow-color', glowColor);
  element.style.setProperty('--feature-popup-glow-size', `${Number(glowSize)}px`);
  content.style.backgroundColor = background;
  content.style.color = textColor;
  content.style.fontFamily = cssFontFamily(fontFamily);
}

function hexToRgba(hex, alpha) {
  const normalized = String(hex || '').replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((character) => character + character).join('')
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(full)) return `rgba(23, 34, 41, ${alpha})`;
  const value = Number.parseInt(full, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function isSafeImageUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  } catch {
    return false;
  }
}

function formatPopupValue(value) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fitMapToCollection(map, collection) {
  const coordinates = [];

  for (const feature of collection.features) {
    collectCoordinates(feature.geometry?.coordinates, coordinates);
  }

  if (coordinates.length === 0) return;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (minLng === maxLng && minLat === maxLat) {
    map.easeTo({ center: [minLng, minLat], zoom: 12 });
    return;
  }

  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 80, duration: 800 },
  );
}

function collectCoordinates(value, result) {
  if (!Array.isArray(value)) return;

  if (
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    result.push(value);
    return;
  }

  for (const child of value) collectCoordinates(child, result);
}

function setupLiveDrawingOverlay(map, engine) {
  const tooltip = document.createElement('div');
  tooltip.className = 'draw-tooltip';
  Object.assign(tooltip.style, {
    position: 'absolute',
    display: 'none',
    pointerEvents: 'none',
    padding: '2px 6px',
    color: '#ffffff',
    background: 'rgba(0, 0, 0, 0.75)',
    borderRadius: '4px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
    fontSize: '12px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    transform: 'translate(12px, -12px)',
    zIndex: '2',
  });
  map.getContainer().appendChild(tooltip);

  const clear = () => {
    const source = map.getSource(LIVE_SEGMENT_SOURCE);
    source?.setData(lineFeature([]));
    tooltip.style.display = 'none';
  };

  const update = (event) => {
    const mode = engine.getMode();
    if (mode !== 'linestring' && mode !== 'polygon') {
      clear();
      return;
    }

    const segment = getProvisionalSegment(engine.getSnapshot(), mode);
    if (!segment) {
      clear();
      return;
    }

    ensureLiveSegmentLayers(map);
    map.getSource(LIVE_SEGMENT_SOURCE)?.setData(lineFeature(segment));

    tooltip.textContent = formatNauticalMiles(
      haversineMeters(segment[0], segment[1]) / 1852,
    );
    tooltip.style.left = `${event.point.x}px`;
    tooltip.style.top = `${event.point.y}px`;
    tooltip.style.display = 'block';
  };

  map.on('mousemove', update);
  map.on('mouseout', clear);

  return { clear };
}

function getProvisionalSegment(snapshot, mode) {
  const feature = snapshot.find(
    (candidate) =>
      candidate.properties?.mode === mode &&
      candidate.properties?.currentlyDrawing === true,
  );

  if (!feature) return null;

  if (mode === 'linestring') {
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    return coordinates.slice(-2);
  }

  const ring = feature.geometry?.coordinates?.[0];
  const committedCount = feature.properties?.committedCoordinateCount;
  if (
    !Array.isArray(ring) ||
    !Number.isInteger(committedCount) ||
    committedCount < 1 ||
    ring.length <= committedCount
  ) {
    return null;
  }

  return [ring[committedCount - 1], ring[committedCount]];
}

function ensureLiveSegmentLayers(map) {
  if (!map.getSource(LIVE_SEGMENT_SOURCE)) {
    map.addSource(LIVE_SEGMENT_SOURCE, {
      type: 'geojson',
      data: lineFeature([]),
    });
  }

  // The casing hides Terra Draw's solid provisional segment. The dashed layer
  // then recreates only that live segment without changing the saved geometry.
  if (!map.getLayer(LIVE_SEGMENT_CASING)) {
    map.addLayer({
      id: LIVE_SEGMENT_CASING,
      type: 'line',
      source: LIVE_SEGMENT_SOURCE,
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.9)',
        'line-width': 5,
      },
    });
  }

  if (!map.getLayer(LIVE_SEGMENT_LINE)) {
    map.addLayer({
      id: LIVE_SEGMENT_LINE,
      type: 'line',
      source: LIVE_SEGMENT_SOURCE,
      layout: {
        'line-cap': 'butt',
      },
      paint: {
        'line-color': '#1e90ff',
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
    });
  }
}

function lineFeature(coordinates) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

function haversineMeters(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b[1] - a[1]);
  const longitudeDelta = toRadians(b[0] - a[0]);
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const h =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatNauticalMiles(distance) {
  if (distance < 10) return `${distance.toFixed(2)} nm`;
  if (distance < 100) return `${distance.toFixed(1)} nm`;
  return `${Math.round(distance)} nm`;
}

export function removeFeatureAppearanceLayers(map) {
  if (!map) return;

  const layerIds = [
    'bottle-of-rhumb-dashed-lines',
    'bottle-of-rhumb-dotted-lines',
    'bottle-of-rhumb-dashed-polygons',
    'bottle-of-rhumb-dotted-polygons',
  ];

  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
}
