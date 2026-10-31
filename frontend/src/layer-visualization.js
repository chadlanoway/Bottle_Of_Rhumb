const PREFIX = 'rhumb-visualization-';
const pendingVisualizationSyncs = new WeakMap();

export const DEFAULT_LAYER_VISUALIZATION = Object.freeze({
  type: 'symbols',
  weightField: '',
  heatRadius: 28,
  heatIntensity: 1,
  heatOpacity: 0.78,
  clusterRadius: 50,
  clusterMaxZoom: 14,
});

export function layerVisualization(layer) {
  return { ...DEFAULT_LAYER_VISUALIZATION, ...layer?.visualization };
}

export function drawingHiddenLayerIds(layers) {
  return (layers ?? [])
    .filter((layer) => !layer.visible || layerVisualization(layer).type !== 'symbols')
    .map((layer) => layer.id);
}

export function numericFieldsForLayer(features, layerId, fallbackLayerId = 'default-layer') {
  const fields = new Map();
  const excluded = new Set([
    'layerId', 'csvRow', 'latitude', 'lat', 'longitude', 'longitude', 'lon', 'lng', 'long',
    'x', 'y', 'xcoord', 'ycoord', 'x_coord', 'y_coord',
  ]);
  for (const feature of features ?? []) {
    if ((feature.properties?.layerId ?? fallbackLayerId) !== layerId) continue;
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (excluded.has(key) || excluded.has(key.toLowerCase())) continue;
      if (Number.isFinite(value)) fields.set(key, (fields.get(key) ?? 0) + 1);
    }
  }
  return [...fields.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .map(([field]) => field);
}

export function layerSupportsPointVisualization(features, layerId, fallbackLayerId = 'default-layer') {
  const layerFeatures = (features ?? []).filter(
    (feature) => (feature.properties?.layerId ?? fallbackLayerId) === layerId,
  );
  return layerFeatures.length > 0
    && layerFeatures.every((feature) => feature.geometry?.type === 'Point');
}

export function syncLayerVisualizations(map, layers, features, fallbackLayerId = 'default-layer') {
  if (!map?.isStyleLoaded?.()) {
    queueVisualizationSync(map, layers, features, fallbackLayerId);
    return;
  }

  pendingVisualizationSyncs.delete(map);

  const activeIds = new Set();
  for (const layer of layers ?? []) {
    const visualization = layerVisualization(layer);
    if (!layer.visible || visualization.type === 'symbols') continue;

    const pointFeatures = (features ?? []).filter((feature) => (
      (feature.properties?.layerId ?? fallbackLayerId) === layer.id
      && feature.geometry?.type === 'Point'
    ));
    if (pointFeatures.length === 0) continue;

    activeIds.add(safeId(layer.id));
    if (visualization.type === 'heatmap') {
      syncHeatmap(map, layer, pointFeatures, visualization);
    } else if (visualization.type === 'clusters') {
      syncClusters(map, layer, pointFeatures, visualization);
    }
  }

  removeInactiveVisualizations(map, activeIds);
}

function queueVisualizationSync(map, layers, features, fallbackLayerId) {
  if (!map?.once) return;

  const pending = pendingVisualizationSyncs.get(map);
  if (pending) {
    pending.layers = layers;
    pending.features = features;
    pending.fallbackLayerId = fallbackLayerId;
    return;
  }

  const request = { layers, features, fallbackLayerId };
  pendingVisualizationSyncs.set(map, request);

  map.once('idle', () => {
    const latest = pendingVisualizationSyncs.get(map);
    if (!latest) return;
    pendingVisualizationSyncs.delete(map);
    syncLayerVisualizations(
      map,
      latest.layers,
      latest.features,
      latest.fallbackLayerId,
    );
  });
}

export function removeLayerVisualizations(map) {
  if (!map?.getStyle?.()) return;
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith(PREFIX) && map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
  for (const sourceId of Object.keys(map.getStyle().sources ?? {})) {
    if (sourceId.startsWith(PREFIX) && map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

function syncHeatmap(map, layer, pointFeatures, visualization) {
  const id = safeId(layer.id);
  const sourceId = `${PREFIX}${id}-heat-source`;
  const layerId = `${PREFIX}${id}-heat`;
  removeVisualizationType(map, id, 'cluster');
  setGeoJsonSource(map, sourceId, pointFeatures, null);

  const values = visualization.weightField
    ? pointFeatures.map((feature) => feature.properties?.[visualization.weightField]).filter(Number.isFinite)
    : [];
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const color = layer.legendColor || '#1e90ff';

  const heatWeight = visualization.weightField && maximum > minimum
    ? [
      'case',
      ['has', visualization.weightField],
      ['interpolate', ['linear'], ['to-number', ['get', visualization.weightField]], minimum, 0, maximum, 1],
      0,
    ]
    : 1;

  const paint = {
    'heatmap-weight': heatWeight,
    'heatmap-intensity': Number(visualization.heatIntensity),
    'heatmap-radius': Number(visualization.heatRadius),
    'heatmap-opacity': Number(visualization.heatOpacity),
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0,0,0,0)',
      0.2, '#2c7bb6',
      0.4, '#00a6ca',
      0.6, '#ffff8c',
      0.8, '#fdae61',
      1, '#d7191c',
    ],
  };

  if (!map.getLayer(layerId)) {
    map.addLayer({ id: layerId, type: 'heatmap', source: sourceId, paint });
  } else {
    for (const [property, value] of Object.entries(paint)) {
      map.setPaintProperty(layerId, property, value);
    }
  }

  // Retain the layer color in the saved model/legend even though the default
  // density ramp uses a multicolor progression.
  void color;
}

function syncClusters(map, layer, pointFeatures, visualization) {
  const id = safeId(layer.id);
  const sourceId = `${PREFIX}${id}-cluster-source`;
  const circleId = `${PREFIX}${id}-cluster-circles`;
  const countId = `${PREFIX}${id}-cluster-count`;
  const pointId = `${PREFIX}${id}-cluster-points`;
  removeVisualizationType(map, id, 'heat');
  setGeoJsonSource(map, sourceId, pointFeatures, {
    cluster: true,
    clusterRadius: Number(visualization.clusterRadius),
    clusterMaxZoom: Number(visualization.clusterMaxZoom),
  });

  const color = layer.legendColor || '#1e90ff';
  if (!map.getLayer(circleId)) {
    map.addLayer({
      id: circleId,
      type: 'circle',
      source: sourceId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': color,
        'circle-opacity': 0.82,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-radius': ['step', ['get', 'point_count'], 17, 25, 22, 100, 28],
      },
    });
    bindLayerHandlerOnce(map, `click:${circleId}`, () => {
      map.on('click', circleId, async (event) => {
        const cluster = event.features?.[0];
        if (!cluster) return;
        const source = map.getSource(sourceId);
        const zoom = await source.getClusterExpansionZoom(cluster.properties.cluster_id);
        map.easeTo({ center: cluster.geometry.coordinates, zoom });
      });
      setPointerCursor(map, circleId);
    });
  } else {
    map.setPaintProperty(circleId, 'circle-color', color);
  }

  if (!map.getLayer(countId)) {
    map.addLayer({
      id: countId,
      type: 'symbol',
      source: sourceId,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    });
  }

  if (!map.getLayer(pointId)) {
    map.addLayer({
      id: pointId,
      type: 'circle',
      source: sourceId,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': color,
        'circle-radius': 7,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
    bindLayerHandlerOnce(map, `cursor:${pointId}`, () => setPointerCursor(map, pointId));
  } else {
    map.setPaintProperty(pointId, 'circle-color', color);
  }
}

function setGeoJsonSource(map, sourceId, features, options) {
  const data = { type: 'FeatureCollection', features };
  const source = map.getSource(sourceId);
  if (source) {
    if (options && typeof source.setClusterOptions === 'function') {
      source.setClusterOptions(options);
    }
    source.setData(data);
    return;
  }
  map.addSource(sourceId, { type: 'geojson', data, ...options });
}

function removeInactiveVisualizations(map, activeIds) {
  for (const sourceId of Object.keys(map.getStyle().sources ?? {})) {
    if (!sourceId.startsWith(PREFIX)) continue;
    const id = sourceId.slice(PREFIX.length).replace(/-(heat|cluster)-source$/, '');
    if (!activeIds.has(id)) removeVisualization(map, id);
  }
}

function removeVisualization(map, id) {
  for (const suffix of ['heat', 'cluster-circles', 'cluster-count', 'cluster-points']) {
    const layerId = `${PREFIX}${id}-${suffix}`;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const suffix of ['heat-source', 'cluster-source']) {
    const sourceId = `${PREFIX}${id}-${suffix}`;
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

function removeVisualizationType(map, id, type) {
  const suffixes = type === 'heat'
    ? ['heat']
    : ['cluster-circles', 'cluster-count', 'cluster-points'];
  for (const suffix of suffixes) {
    const layerId = `${PREFIX}${id}-${suffix}`;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  const sourceId = `${PREFIX}${id}-${type}-source`;
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function setPointerCursor(map, layerId) {
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
}

function bindLayerHandlerOnce(map, key, bind) {
  if (!map.rhumbVisualizationHandlers) map.rhumbVisualizationHandlers = new Set();
  if (map.rhumbVisualizationHandlers.has(key)) return;
  map.rhumbVisualizationHandlers.add(key);
  bind();
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}
