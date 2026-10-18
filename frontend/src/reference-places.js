import { Popup } from 'maplibre-gl';

const DATASETS = {
  ports: {
    url: 'https://portsmastertable.s3.amazonaws.com/PORTS_REGIONAL_LD.geojson',
    sourceId: 'rhumb-reference-ports',
    color: '#f1f075',
    label: 'Ports',
    icon: '⚓',
  },
  marinas: {
    url: 'https://portsmastertable.s3.amazonaws.com/PORTS_LD.geojson',
    sourceId: 'rhumb-reference-marinas',
    color: '#f28cb1',
    label: 'Marinas',
    icon: '⛵',
  },
};

const dataPromises = new Map();

export class ReferencePlacesControl {
  constructor(map, weatherControl, onAddPoint) {
    this.map = map;
    this.weatherControl = weatherControl;
    this.onAddPoint = onAddPoint;
    this.visible = new Set();
    this.popup = null;
    this.handlers = [];

    for (const [kind, config] of Object.entries(DATASETS)) {
      weatherControl.addButton(kind, config.icon, `Show ${config.label.toLowerCase()}`, () => {
        this.toggle(kind).catch((error) => {
          console.error(`${config.label} failed to load:`, error);
          this.setButtonState(kind, { loading: false, unavailable: true, title: error.message });
        });
      });
    }

    weatherControl.buttons.get('ports')?.classList.add('rhumb-control-reference-start');
    map.once('remove', () => this.destroy());
  }

  async toggle(kind) {
    const config = DATASETS[kind];
    if (!config) return;
    const showing = !this.visible.has(kind);

    if (showing && !this.map.getSource(config.sourceId)) {
      this.setButtonState(kind, { loading: true });
      await this.load(kind);
      this.setButtonState(kind, { loading: false });
    }

    this.setVisibility(kind, showing);
    if (showing) this.visible.add(kind);
    else this.visible.delete(kind);
    this.setButtonState(kind, {
      active: showing,
      title: `${showing ? 'Hide' : 'Show'} ${config.label.toLowerCase()}`,
    });
  }

  async load(kind) {
    const config = DATASETS[kind];
    const collection = await fetchCollection(config.url);
    if (this.map.getSource(config.sourceId)) return;

    this.map.addSource(config.sourceId, {
      type: 'geojson',
      data: collection,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    const clusterId = `${config.sourceId}-clusters`;
    const countId = `${config.sourceId}-count`;
    const pointId = `${config.sourceId}-points`;

    this.map.addLayer({
      id: clusterId,
      type: 'circle',
      source: config.sourceId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': config.color,
        'circle-radius': ['step', ['get', 'point_count'], 14, 100, 20, 750, 25],
        'circle-opacity': 0.72,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
      layout: { visibility: 'none' },
    });

    this.map.addLayer({
      id: countId,
      type: 'symbol',
      source: config.sourceId,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 12,
        visibility: 'none',
      },
      paint: { 'text-color': '#172229' },
    });

    this.map.addLayer({
      id: pointId,
      type: 'circle',
      source: config.sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': config.color,
        'circle-radius': 6,
        'circle-opacity': 0.86,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
      layout: { visibility: 'none' },
    });

    this.listen('click', clusterId, async (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const zoom = await this.map.getSource(config.sourceId)
        .getClusterExpansionZoom(feature.properties.cluster_id);
      this.map.easeTo({ center: feature.geometry.coordinates, zoom });
    });
    this.listen('click', pointId, (event) => this.showPlace(kind, event.features?.[0]));
    this.listen('mouseenter', clusterId, () => { this.map.getCanvas().style.cursor = 'pointer'; });
    this.listen('mouseleave', clusterId, () => { this.map.getCanvas().style.cursor = ''; });
    this.listen('mouseenter', pointId, () => { this.map.getCanvas().style.cursor = 'pointer'; });
    this.listen('mouseleave', pointId, () => { this.map.getCanvas().style.cursor = ''; });
  }

  showPlace(kind, feature) {
    if (!feature) return;
    const savedFeature = makeSavedFeature(kind, feature);
    const content = buildReferencePopup(kind, savedFeature, async () => {
      try {
        await this.onAddPoint?.(savedFeature, kind);
        const button = content.querySelector('.reference-place-add');
        if (button) {
          button.textContent = '✓ Added to map';
          button.disabled = true;
        }
      } catch (error) {
        const status = content.querySelector('.reference-place-status');
        if (status) status.textContent = error.message || 'Could not add this point.';
      }
    });

    this.popup?.remove();
    this.popup = new Popup({
      closeButton: true,
      maxWidth: '340px',
      className: 'reference-place-map-popup',
    })
      .setLngLat(feature.geometry.coordinates.slice())
      .setDOMContent(content)
      .addTo(this.map);
  }

  setVisibility(kind, visible) {
    const sourceId = DATASETS[kind].sourceId;
    for (const suffix of ['clusters', 'count', 'points']) {
      const layerId = `${sourceId}-${suffix}`;
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  setButtonState(kind, state) {
    const button = this.weatherControl.buttons.get(kind);
    if (!button) return;
    if ('loading' in state) button.classList.toggle('is-loading', state.loading);
    if ('active' in state) {
      button.classList.toggle('is-active', state.active);
      button.setAttribute('aria-pressed', String(state.active));
    }
    if (state.unavailable) {
      button.disabled = true;
      button.classList.add('is-unavailable');
    }
    if (state.title) button.title = state.title;
  }

  listen(event, layerId, handler) {
    this.map.on(event, layerId, handler);
    this.handlers.push([event, layerId, handler]);
  }

  destroy() {
    this.popup?.remove();
    for (const [event, layerId, handler] of this.handlers) {
      try { this.map.off(event, layerId, handler); } catch { /* map is being removed */ }
    }
    this.handlers = [];
  }
}

async function fetchCollection(url) {
  if (!dataPromises.has(url)) {
    dataPromises.set(url, fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Dataset request failed (${response.status}).`);
        return response.text();
      })
      .then((text) => {
        const trimmed = text.trim();
        if (!trimmed) return { type: 'FeatureCollection', features: [] };
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'FeatureCollection') return parsed;
        } catch { /* newline-delimited GeoJSON */ }
        return {
          type: 'FeatureCollection',
          features: trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
        };
      })
      .catch((error) => {
        dataPromises.delete(url);
        throw error;
      }));
  }
  return dataPromises.get(url);
}

function makeSavedFeature(kind, feature) {
  const raw = feature.properties || {};
  const properties = kind === 'marinas'
    ? marinaProperties(raw)
    : portProperties(raw);
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: feature.geometry.coordinates
        .slice(0, 2)
        .map((coordinate) => Number(coordinate.toFixed(6))),
    },
    properties: {
      ...properties.values,
      source: kind === 'marinas' ? 'Ports Master Table – marinas' : 'Ports Master Table – regional ports',
      referenceType: kind === 'marinas' ? 'marina' : 'port',
      popupEnabled: true,
      popupTitle: properties.name,
      popupDescription: kind === 'marinas' ? 'Marina reference point' : 'Port reference point',
      popupFields: properties.fields,
    },
  };
}

function marinaProperties(raw) {
  const mapped = {
    Country: raw.SOVEREIGNT,
    'Nearest airport': joinAirport(raw),
    Language: raw.LANGUAGE,
    Demonym: raw.DEMONYM,
    Currency: raw.CURRENCY,
    'Phone code': raw.PHONE_CODE,
    Voltage: raw.VOLTAGE,
    Frequency: raw.FREQUENCY,
    'Plug types': raw.PLUG_TYPES,
    Economy: raw.ECONOMY,
  };
  const name = raw.PORT_NAME || raw.NAME || 'Unnamed marina';
  return normalizedProperties(name, mapped);
}

function portProperties(raw) {
  const ignored = new Set(['Latitude', 'Longitude']);
  const mapped = Object.fromEntries(Object.entries(raw).filter(([key, value]) => (
    !ignored.has(key) && useful(value)
  )));
  const name = raw['Main Port Name'] || raw.PORT_NAME || raw.NAME || 'Unnamed port';
  return normalizedProperties(name, mapped);
}

function normalizedProperties(name, mapped) {
  const values = { name };
  const fields = [];
  for (const [key, value] of Object.entries(mapped)) {
    if (!useful(value) || key === 'name') continue;
    values[key] = value;
    fields.push(key);
  }
  return { name, values, fields };
}

function joinAirport(raw) {
  const name = raw.NEAREST_AIRPORT_NAME || '';
  const code = raw.NEAREST_AIRPORT_IATA ? ` (${raw.NEAREST_AIRPORT_IATA})` : '';
  const distance = raw.NEAREST_AIRPORT_DISTANCE_KM
    ? ` – ${raw.NEAREST_AIRPORT_DISTANCE_KM} km` : '';
  return `${name}${code}${distance}`.trim();
}

function useful(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'Unknown' && value !== '0.0';
}

function buildReferencePopup(kind, feature, onAdd) {
  const properties = feature.properties;
  const article = document.createElement('article');
  article.className = 'reference-place-popup';
  const heading = document.createElement('h3');
  heading.textContent = properties.name;
  article.appendChild(heading);

  const list = document.createElement('dl');
  for (const key of properties.popupFields) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = key;
    value.textContent = String(properties[key]);
    row.append(term, value);
    list.appendChild(row);
  }
  article.appendChild(list);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reference-place-add';
  button.textContent = `＋ Add ${kind === 'marinas' ? 'marina' : 'port'} to map`;
  button.addEventListener('click', onAdd);
  article.appendChild(button);
  const status = document.createElement('p');
  status.className = 'reference-place-status';
  status.setAttribute('role', 'status');
  article.appendChild(status);
  return article;
}
