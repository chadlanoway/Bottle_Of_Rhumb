import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { RhumbMapControl } from './weather-controls.js';
import { ReferencePlacesControl } from './reference-places.js';

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
  {
    id: 'fiord',
    name: 'Fiord',
    description: 'Cool, dark-blue background suited to marine maps.',
    style: 'https://tiles.openfreemap.org/styles/fiord',
  },
  {
    id: 'hiking',
    name: 'Hiking',
    description: 'Trails, route shields, contours and terrain shading.',
    style: 'https://styles.maptoolkit.org/hiking.json',
  },
  {
    id: 'nautical',
    name: 'Nautical',
    description: 'Seamarks, hazards, bathymetry and marine infrastructure.',
    style: 'https://tiles.openwaters.io/seamap/style.json',
  },
  {
    id: 'cycling',
    name: 'Cycling',
    description: 'Cycle routes, paths, contours and terrain shading.',
    style: 'https://styles.maptoolkit.org/cycling.json',
  },
  {
    id: 'winter',
    name: 'Winter',
    description: 'Ski trails, lifts and winter recreation features.',
    style: 'https://styles.maptoolkit.org/winter.json',
  },
  {
    id: 'seafloor',
    name: 'Seafloor',
    description: 'Depth shading, contours and soundings shown in feet.',
    style: 'https://tiles.openwaters.io/seascape/style.json?unit=ft&safety=2',
  },
  {
    id: 'americana',
    name: 'Americana',
    description: 'US road-atlas styling with highway and route shields.',
    style: 'https://americanamap.org/style.json',
  },
  {
    id: 'three-d',
    name: '3D',
    description: 'OpenFreeMap streets with extruded buildings.',
    style: 'https://tiles.openfreemap.org/styles/liberty',
  },
];

const MAPTOOLKIT_BASEMAP_IDS = new Set(['hiking', 'cycling', 'winter']);

export function createMap(container, basemapId = 'positron', options = {}) {
  const map = new maplibregl.Map({
    container,
    style: getBasemap(basemapId).style,
    center: [3, 60],
    zoom: 3.5,
    attributionControl: MAPTOOLKIT_BASEMAP_IDS.has(basemapId) ? { compact: false } : true,
  });

  if (MAPTOOLKIT_BASEMAP_IDS.has(basemapId)) {
    map.addControl(new MaptoolkitLogoControl(), 'bottom-left');
  }

  const projection = options.projection === 'globe' ? 'globe' : 'mercator';
  if (projection === 'globe') {
    map.once('style.load', () => {
      map.setProjection({ type: 'globe' });
    });
  }

  const weatherControl = new RhumbMapControl(projection);
  map.addControl(weatherControl, 'top-right');
  map.rhumbWeatherControl = weatherControl;
  map.rhumbReferencePlaces = new ReferencePlacesControl(
    map,
    weatherControl,
    options.onAddReferencePoint,
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
    map.easeTo({ center: [minLng, minLat], zoom: 5, duration: 700 });
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

class MaptoolkitLogoControl {
  onAdd() {
    const link = document.createElement('a');
    link.className = 'maptoolkit-logo-control';
    link.href = 'https://www.maptoolkit.org/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Maptoolkit';

    const image = document.createElement('img');
    image.src = 'https://www.maptoolkit.org/assets/maptoolkit-attribution.png';
    image.alt = 'Maptoolkit';
    link.appendChild(image);

    this.container = link;
    return link;
  }

  onRemove() {
    this.container?.remove();
    this.container = null;
  }
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
