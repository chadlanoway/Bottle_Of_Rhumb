import { MaplibreTerradrawControl } from '@watergis/maplibre-gl-terradraw';
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
const TEXT_SOURCE = 'bottle-of-rhumb-text';
const FEATURE_LABEL_LAYER = 'bottle-of-rhumb-feature-labels';
const FREE_TEXT_LAYER = 'bottle-of-rhumb-free-text';
const backgroundMarkerStates = new WeakMap();
const previewPopups = new WeakMap();

export function setupDrawingTools(map, onChange, getActiveLayerId, onSelectionChange) {
  const draw = new MaplibreTerradrawControl({
    modes: ['point', 'linestring', 'polygon', 'text', 'select'],
    open: true,
  });

  map.addControl(draw, 'top-right');

  const engine = draw.getTerraDrawInstance();
  ensureTextLayers(map);
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
    onSelectionChange?.(id);
    reportChange();
  });
  engine?.on('change', reportChange);
  engine?.on('select', (id) => {
    onSelectionChange?.(id);
    reportChange();
  });
  engine?.on('deselect', () => {
    onSelectionChange?.(null);
    reportChange();
  });

  if (engine) {
    const liveOverlay = setupLiveDrawingOverlay(map, engine);
    liveDrawingOverlays.set(draw, liveOverlay);
    engine.on('finish', liveOverlay.clear);
  }

  map.on('click', FREE_TEXT_LAYER, (event) => {
    const id = event.features?.[0]?.id;
    if (id === undefined) return;
    engine?.selectFeature(id);
    onSelectionChange?.(id);
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
    text: 'text',
    select: 'select',
  };

  const engine = draw.getTerraDrawInstance();
  liveDrawingOverlays.get(draw)?.clear();

  const mode = modes[geometryType];
  if (!mode) throw new Error(`Unknown drawing type: ${geometryType}`);
  engine?.setMode(mode);
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

export function deleteLayerFeatures(draw, layerId) {
  const engine = draw?.getTerraDrawInstance();
  if (!engine) return;

  const ids = engine
    .getSnapshot()
    .filter((feature) => feature.properties?.layerId === layerId)
    .map((feature) => feature.id);

  if (ids.length > 0) engine.removeFeatures(ids);
}

export function selectFeature(draw, id) {
  draw?.getTerraDrawInstance()?.selectFeature(id);
}

export function updateFeature(draw, id, properties) {
  const engine = draw?.getTerraDrawInstance();
  engine?.updateFeatureProperties(id, properties);
}

export function previewFeaturePopup(draw, map, id) {
  if (!draw || !map || id === null || id === undefined) return;
  const feature = draw.getTerraDrawInstance()?.getSnapshot().find(
    (candidate) => String(candidate.id) === String(id),
  );
  if (!feature?.properties?.popupEnabled) return;

  previewPopups.get(map)?.remove();
  const popup = new Popup({ closeButton: true, closeOnClick: false, maxWidth: '320px' })
    .setLngLat(popupCoordinates(feature, map))
    .setDOMContent(buildPopupElement(feature.properties))
    .addTo(map);
  previewPopups.set(map, popup);
}

export function setHiddenLayers(draw, map, hiddenLayerIds) {
  if (!draw || !map) return;

  const hidden = [
    'in',
    ['coalesce', ['get', 'layerId'], 'default-layer'],
    ['literal', hiddenLayerIds],
  ];
  const filter = ['!', hidden];

  for (const layerId of ['td-linestring', 'td-polygon', 'td-polygon-outline']) {
    if (map.getLayer(layerId)) map.setFilter(layerId, filter);
  }

  const pointFilter = ['all', filter, [
    'any',
    ['!=', ['get', 'featureType'], 'text'],
    ['==', ['get', 'selected'], true],
  ]];
  for (const layerId of ['td-point', 'td-point-marker']) {
    if (map.getLayer(layerId)) map.setFilter(layerId, pointFilter);
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

export async function importGeoJSON(draw, map, file, activeLayerId) {
  const collection = JSON.parse(await file.text());

  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('The selected file is not a GeoJSON FeatureCollection.');
  }

  const engine = draw.getTerraDrawInstance();
  engine.clear();

  const supportedFeatures = collection.features.map((feature) => {
    const mode = geometryMode(feature.geometry?.type);

    if (!mode) {
      throw new Error(
        `Geometry type ${feature.geometry?.type ?? 'unknown'} is not supported yet.`,
      );
    }

    return {
      ...feature,
      id: feature.id ?? engine.getFeatureId(),
      properties: {
        ...feature.properties,
        layerId: feature.properties?.layerId ?? activeLayerId,
        mode,
      },
    };
  });

  engine.addFeatures(supportedFeatures);
  fitMapToCollection(map, collection);
  return getFeatureCollection(draw);
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
  hideNativeTextLayer(map);
  requestAnimationFrame(() => hideNativeTextLayer(map));
}

function featureLabelFilter() {
  return ['all', ['==', ['get', 'labelEnabled'], true], ['!=', ['get', 'featureType'], 'text'], ['!=', ['get', 'textBackground'], true]];
}

function freeTextFilter() {
  return ['all', ['==', ['get', 'featureType'], 'text'], ['!=', ['get', 'textBackground'], true]];
}

function hideNativeTextLayer(map) {
  if (map.getLayer('td-text-labels')) {
    map.setLayoutProperty('td-text-labels', 'visibility', 'none');
  }
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
      state.onSelectionChange?.(feature.id);
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
