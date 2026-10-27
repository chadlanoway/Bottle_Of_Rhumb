const MAPS_API_URL = String(import.meta.env.VITE_MAPS_API_URL || '').replace(/\/$/, '');

export async function loadMap(mapId, accessToken) {
  requireApi();
  if (accessToken) {
    const editableResponse = await request(
      `/maps/${encodeURIComponent(mapId)}/edit`,
      { accessToken, allowFailure: true },
    );
    if (editableResponse.ok) {
      return { map: editableResponse.payload.map, editable: true };
    }
  }

  const publicResponse = await request(`/maps/${encodeURIComponent(mapId)}`);
  return { map: publicResponse.payload.map, editable: false };
}

export async function listMaps(accessToken) {
  requireToken(accessToken);
  const response = await request('/maps', { accessToken });
  return Array.isArray(response.payload.maps) ? response.payload.maps : [];
}

export async function createMap(map, accessToken) {
  requireToken(accessToken);
  const response = await request('/maps', {
    method: 'POST',
    accessToken,
    body: map,
  });
  return response.payload.map;
}

export async function updateMap(mapId, map, accessToken) {
  requireToken(accessToken);
  const response = await request(`/maps/${encodeURIComponent(mapId)}`, {
    method: 'PUT',
    accessToken,
    body: map,
  });
  return response.payload.map;
}

export async function deleteMap(mapId, accessToken) {
  requireToken(accessToken);
  await request(`/maps/${encodeURIComponent(mapId)}`, {
    method: 'DELETE',
    accessToken,
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${MAPS_API_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await readJson(response);
  if (!response.ok && !options.allowFailure) {
    throw new Error(
      payload.error
      || payload.message
      || payload.detail
      || `Map request failed (${response.status}).`,
    );
  }
  return { ok: response.ok, status: response.status, payload };
}

function requireApi() {
  if (!MAPS_API_URL) {
    throw new Error('VITE_MAPS_API_URL is not configured.');
  }
}

function requireToken(token) {
  requireApi();
  if (!token) throw new Error('Sign in before saving this map.');
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}
