import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-96, 38],
    zoom: 3,
    attributionControl: true,
  });

  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    'bottom-right',
  );

  map.addControl(
    new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }),
    'bottom-left',
  );

  return map;
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
