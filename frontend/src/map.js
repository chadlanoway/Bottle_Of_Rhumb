import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { RhumbMapControl } from './weather-controls.js';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
globalThis.mapboxgl ??= maplibregl;

export const BASEMAPS = [
  {
    id: 'positron',
    name: 'Grayscale',
    description: 'Quiet, low-contrast background for user data.',
    style: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'liberty',
    name: 'Liberty',
    description: 'General-purpose color basemap.',
    style: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'bright',
    name: 'Bright',
    description: 'Clear streets and place labels.',
    style: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Dark background for bright overlays.',
    style: 'https://tiles.openfreemap.org/styles/dark',
  },
];

export function createMap(container, basemapId = 'positron') {
  const map = new maplibregl.Map({
    container,
    style: getBasemap(basemapId).style,
    center: [-96, 38],
    zoom: 3,
    attributionControl: true,
  });

  map.once('load', () => rememberBasemapParts(map));

  const weatherControl = new RhumbMapControl();
  map.addControl(weatherControl, 'top-right');
  map.rhumbWeatherControl = weatherControl;

  map.addControl(
    new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }),
    'bottom-left',
  );

  return map;
}

export function setBasemap(map, basemapId) {
  if (!map) return;
  const nextBasemap = getBasemap(basemapId);
  const oldSourceIds = map.__rhumbBasemapSourceIds ?? new Set();
  const oldLayerIds = map.__rhumbBasemapLayerIds ?? new Set();

  map.setStyle(nextBasemap.style, {
    diff: true,
    transformStyle: (previousStyle, nextStyle) => {
      map.__rhumbBasemapSourceIds = new Set(Object.keys(nextStyle.sources ?? {}));
      map.__rhumbBasemapLayerIds = new Set((nextStyle.layers ?? []).map((layer) => layer.id));
      return preserveEditorOverlays(
        previousStyle,
        nextStyle,
        oldSourceIds,
        oldLayerIds,
      );
    },
  });
}

export function getMapView(map) {
  const center = map.getCenter();

  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

export function previewMapView(map, view) {
  if (!map || !view) return;
  map.easeTo({ ...view, duration: 700 });
}

export function fitMapToFeatures(map, features, onComplete) {
  const coordinates = [];

  for (const feature of features) {
    collectCoordinates(feature.geometry?.coordinates, coordinates);
  }

  if (coordinates.length === 0) return false;

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

  map.once('moveend', () => onComplete?.(getMapView(map)));

  if (minLng === maxLng && minLat === maxLat) {
    map.easeTo({ center: [minLng, minLat], zoom: Math.max(map.getZoom(), 12), duration: 700 });
  } else {
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 70, duration: 700 },
    );
  }

  return true;
}

function getBasemap(id) {
  return BASEMAPS.find((basemap) => basemap.id === id) ?? BASEMAPS[0];
}

function rememberBasemapParts(map) {
  const style = map.getStyle();
  map.__rhumbBasemapSourceIds = new Set(Object.keys(style.sources ?? {}));
  map.__rhumbBasemapLayerIds = new Set((style.layers ?? []).map((layer) => layer.id));
}

function preserveEditorOverlays(previousStyle, nextStyle, basemapSourceIds, basemapLayerIds) {
  if (!previousStyle) return nextStyle;

  const customSources = Object.fromEntries(
    Object.entries(previousStyle.sources ?? {}).filter(([id]) => !basemapSourceIds.has(id)),
  );
  const customLayers = (previousStyle.layers ?? []).filter(
    (layer) => !basemapLayerIds.has(layer.id),
  );

  return {
    ...nextStyle,
    sources: { ...nextStyle.sources, ...customSources },
    layers: [...(nextStyle.layers ?? []), ...customLayers],
  };
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
