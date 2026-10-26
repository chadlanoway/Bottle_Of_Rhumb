import { Marker } from 'maplibre-gl';

function markerElement(label, className) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = label;
  return element;
}

function pointFromResult(result) {
  const [lng, lat] = result?.coordinates ?? [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('The search result does not contain valid coordinates.');
  }
  return { lng, lat };
}

export function createLandRoutingController(map, {
  apiUrl,
  onActiveChange,
  onError,
  onRoute,
  onStatus,
}) {
  let active = false;
  let loading = false;
  let profile = 'foot-walking';
  let start = null;
  let startMarker = null;
  let endMarker = null;

  function removeMarkers() {
    startMarker?.remove();
    endMarker?.remove();
    startMarker = null;
    endMarker = null;
  }

  function setActive(value) {
    active = value;
    map.getCanvas().style.cursor = value ? 'crosshair' : '';
    onActiveChange?.(value);
  }

  function placeStart(point) {
    start = point;
    startMarker?.remove();
    startMarker = new Marker({
      element: markerElement('A', 'route-endpoint-marker route-start-marker'),
      anchor: 'center',
    }).setLngLat([point.lng, point.lat]).addTo(map);
  }

  function arm(nextProfile = 'foot-walking', presetStart = null) {
    removeMarkers();
    profile = nextProfile;
    start = null;
    setActive(true);

    if (presetStart) {
      placeStart(presetStart);
      onStatus?.('Click the map to choose the route destination.');
    } else {
      onStatus?.('Click the map to choose the route starting point.');
    }
  }

  function cancel() {
    loading = false;
    start = null;
    removeMarkers();
    setActive(false);
    onStatus?.('');
  }

  async function handleMapClick(event) {
    if (!active || loading) return;
    const point = { lng: event.lngLat.lng, lat: event.lngLat.lat };

    if (!start) {
      placeStart(point);
      onStatus?.('Click the map to choose the route destination.');
      return;
    }

    endMarker?.remove();
    endMarker = new Marker({
      element: markerElement('B', 'route-endpoint-marker route-end-marker'),
      anchor: 'center',
    }).setLngLat([point.lng, point.lat]).addTo(map);

    loading = true;
    onStatus?.('Calculating route…');

    try {
      const payload = await requestApi(apiUrl, {
        action: 'route',
        profile,
        start,
        end: point,
      });
      if (payload?.route?.type !== 'FeatureCollection') {
        throw new Error('The routing service did not return GeoJSON.');
      }
      await onRoute?.(payload, profile);
      onStatus?.('Route added to the active layer.');
      start = null;
      removeMarkers();
      setActive(false);
    } catch (error) {
      onError?.(error);
      onStatus?.(error.message || 'Unable to calculate the route.');
    } finally {
      loading = false;
    }
  }

  map.on('click', handleMapClick);

  return {
    arm,
    cancel,
    destroy() {
      cancel();
      map.off('click', handleMapClick);
    },
  };
}

export async function searchAddresses(apiUrl, query) {
  const text = query.trim();
  if (text.length < 3) throw new Error('Enter at least three characters.');
  const payload = await requestApi(apiUrl, { action: 'geocode', query: text });
  return Array.isArray(payload?.results) ? payload.results : [];
}

export function showSearchResult(map, result, previousMarker) {
  previousMarker?.remove();
  const point = pointFromResult(result);
  const marker = new Marker({
    element: markerElement('⌖', 'search-result-marker'),
    anchor: 'bottom',
  }).setLngLat([point.lng, point.lat]).addTo(map);
  map.flyTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  return marker;
}

export function searchResultPoint(result) {
  return pointFromResult(result);
}

export async function requestWaterRoute(apiUrl, start, end, name = 'Water route', signal) {
  if (!apiUrl) throw new Error('VITE_WATER_ROUTING_API_URL is not configured.');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      start: { lng: start[0], lat: start[1] },
      end: { lng: end[0], lat: end[1] },
      name,
    }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The water-routing service returned an unreadable response.');
  }
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || `Water-routing error ${response.status}.`);
  }
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('The water-routing service did not return GeoJSON.');
  }
  if (!payload.features.some((feature) => feature?.properties?.featureType === 'water-route')) {
    throw new Error('The water-routing response did not contain a route.');
  }
  return {
    ...payload,
    features: payload.features.map((feature) => ({
      ...feature,
      geometry: feature?.geometry
        ? {
            ...feature.geometry,
            coordinates: roundGeoJSONCoordinates(feature.geometry.coordinates),
          }
        : feature?.geometry,
    })),
  };
}

function roundGeoJSONCoordinates(value) {
  if (!Array.isArray(value)) return value;
  if (
    value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
  ) {
    return value.map((coordinate) => (
      typeof coordinate === 'number'
        ? Number(coordinate.toFixed(6))
        : coordinate
    ));
  }
  return value.map(roundGeoJSONCoordinates);
}

async function requestApi(apiUrl, body) {
  if (!apiUrl) throw new Error('VITE_LAND_ROUTING_API_URL is not configured.');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The map service returned an unreadable response.');
  }
  if (!response.ok) {
    throw new Error(payload?.error || payload?.detail || `Map service error ${response.status}.`);
  }
  return payload;
}
