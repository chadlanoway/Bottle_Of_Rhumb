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
  choroplethField: '',
  choroplethNormalization: 'none',
  choroplethDenominatorField: '',
  choroplethRateScale: 1,
  choroplethAreaUnit: 'square-kilometers',
  choroplethMethod: 'quantile',
  choroplethClasses: 5,
  choroplethRamp: 'blues',
  choroplethReverse: false,
  choroplethOpacity: 0.78,
  choroplethOutlineColor: '#ffffff',
  choroplethOutlineWidth: 1,
  choroplethNoDataColor: '#9aa3ad',
});

export const CHOROPLETH_RAMPS = Object.freeze({
  blues: { label: 'Blues', colors: ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#084594'] },
  yellowRed: { label: 'Yellow to red', colors: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'] },
  viridis: { label: 'Viridis', colors: ['#440154', '#443983', '#31688e', '#21918c', '#35b779', '#90d743', '#fde725'] },
  purple: { label: 'Purples', colors: ['#f2f0f7', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#4a1486'] },
  diverging: { label: 'Blue to red', colors: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'] },
});

export function layerVisualization(layer) {
  return { ...DEFAULT_LAYER_VISUALIZATION, ...layer?.visualization };
}

export function drawingHiddenLayerIds(layers) {
  return (layers ?? [])
    .filter((layer) => !layer.visible || layerVisualization(layer).type !== 'symbols')
    .map((layer) => layer.id);
}

export function setLayerVisualizationVisibility(map, layerId, visible) {
  if (!map?.getLayer || layerId === null || layerId === undefined) return;

  const id = safeId(layerId);
  const visibility = visible ? 'visible' : 'none';
  const suffixes = [
    'heat',
    'cluster-circles',
    'cluster-count',
    'cluster-points',
    'choropleth-fill',
    'choropleth-outline',
  ];

  for (const suffix of suffixes) {
    const visualizationLayerId = `${PREFIX}${id}-${suffix}`;
    if (map.getLayer(visualizationLayerId)) {
      map.setLayoutProperty(visualizationLayerId, 'visibility', visibility);
    }
  }
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

export function layerSupportsPolygonVisualization(features, layerId, fallbackLayerId = 'default-layer') {
  const layerFeatures = (features ?? []).filter(
    (feature) => (feature.properties?.layerId ?? fallbackLayerId) === layerId,
  );
  return layerFeatures.length > 0
    && layerFeatures.every((feature) => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
}

export function buildChoroplethClasses(features, visualization) {
  const field = visualization?.choroplethField;
  if (!field) return [];
  const analysis = analyzeChoroplethValues(features, visualization);
  const values = analysis.values.map((entry) => entry.value).sort((a, b) => a - b);
  if (values.length === 0) return [];

  const requested = clamp(Math.round(Number(visualization.choroplethClasses) || 5), 3, 7);
  const classCount = Math.min(requested, new Set(values).size);
  const method = visualization.choroplethMethod || 'quantile';
  let thresholds;
  if (method === 'equal') thresholds = equalIntervalThresholds(values, classCount);
  else if (method === 'jenks') thresholds = jenksThresholds(values, classCount);
  else thresholds = quantileThresholds(values, classCount);
  thresholds = [...new Set(thresholds)].filter((value) => Number.isFinite(value));

  const ramp = CHOROPLETH_RAMPS[visualization.choroplethRamp] ?? CHOROPLETH_RAMPS.blues;
  const colors = sampleColors(
    visualization.choroplethReverse ? [...ramp.colors].reverse() : ramp.colors,
    thresholds.length + 1,
  );
  const boundaries = [values[0], ...thresholds, values[values.length - 1]];
  return colors.map((color, index) => ({
    color,
    minimum: boundaries[index],
    maximum: boundaries[index + 1],
    label: formatClassRange(
      boundaries[index],
      boundaries[index + 1],
      index === colors.length - 1,
      analysis.unit,
    ),
  }));
}

export function choroplethNormalizationReport(features, visualization) {
  const analysis = analyzeChoroplethValues(features, visualization);
  return {
    validCount: analysis.values.length,
    excludedCount: (features ?? []).length - analysis.values.length,
    formula: analysis.formula,
    unit: analysis.unit,
  };
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
    if (!layer.visible || visualization.type === 'symbols') {
      setLayerVisualizationVisibility(map, layer.id, false);
      continue;
    }

    if (visualization.type === 'choropleth') {
      const polygonFeatures = (features ?? []).filter((feature) => (
        (feature.properties?.layerId ?? fallbackLayerId) === layer.id
        && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
      ));
      if (polygonFeatures.length === 0 || !visualization.choroplethField) continue;
      activeIds.add(safeId(layer.id));
      syncChoropleth(map, layer, polygonFeatures, visualization);
      setLayerVisualizationVisibility(map, layer.id, true);
      continue;
    }

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
    setLayerVisualizationVisibility(map, layer.id, true);
  }

  removeInactiveVisualizations(map, activeIds);
}

function syncChoropleth(map, layer, polygonFeatures, visualization) {
  const id = safeId(layer.id);
  const sourceId = `${PREFIX}${id}-choropleth-source`;
  const fillId = `${PREFIX}${id}-choropleth-fill`;
  const outlineId = `${PREFIX}${id}-choropleth-outline`;
  removeVisualizationType(map, id, 'heat');
  removeVisualizationType(map, id, 'cluster');
  const analysis = analyzeChoroplethValues(polygonFeatures, visualization);
  const renderedFeatures = polygonFeatures.map((feature, index) => ({
    ...feature,
    properties: {
      ...feature.properties,
      __rhumbChoroplethValue: analysis.byIndex.get(index) ?? null,
    },
  }));
  setGeoJsonSource(map, sourceId, renderedFeatures, null);

  const classes = buildChoroplethClasses(polygonFeatures, visualization);
  if (classes.length === 0) {
    removeVisualizationType(map, id, 'choropleth');
    return;
  }
  const field = '__rhumbChoroplethValue';
  const step = ['step', ['to-number', ['get', field]], classes[0].color];
  for (let index = 1; index < classes.length; index += 1) {
    step.push(classes[index].minimum, classes[index].color);
  }
  const fillColor = [
    'case',
    ['all', ['has', field], ['!=', ['get', field], null]],
    step,
    visualization.choroplethNoDataColor,
  ];
  const fillPaint = {
    'fill-color': fillColor,
    'fill-opacity': Number(visualization.choroplethOpacity),
  };
  const linePaint = {
    'line-color': visualization.choroplethOutlineColor,
    'line-width': Number(visualization.choroplethOutlineWidth),
  };

  if (!map.getLayer(fillId)) map.addLayer({ id: fillId, type: 'fill', source: sourceId, paint: fillPaint });
  else for (const [property, value] of Object.entries(fillPaint)) map.setPaintProperty(fillId, property, value);
  if (!map.getLayer(outlineId)) map.addLayer({ id: outlineId, type: 'line', source: sourceId, paint: linePaint });
  else for (const [property, value] of Object.entries(linePaint)) map.setPaintProperty(outlineId, property, value);

  bindLayerHandlerOnce(map, `cursor:${fillId}`, () => setPointerCursor(map, fillId));
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
    syncLayerVisualizations(map, latest.layers, latest.features, latest.fallbackLayerId);
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
    const id = sourceId.slice(PREFIX.length).replace(/-(heat|cluster|choropleth)-source$/, '');
    if (!activeIds.has(id)) removeVisualization(map, id);
  }
}

function removeVisualization(map, id) {
  for (const suffix of ['heat', 'cluster-circles', 'cluster-count', 'cluster-points', 'choropleth-fill', 'choropleth-outline']) {
    const layerId = `${PREFIX}${id}-${suffix}`;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const suffix of ['heat-source', 'cluster-source', 'choropleth-source']) {
    const sourceId = `${PREFIX}${id}-${suffix}`;
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

function removeVisualizationType(map, id, type) {
  const suffixes = type === 'heat'
    ? ['heat']
    : type === 'cluster'
      ? ['cluster-circles', 'cluster-count', 'cluster-points']
      : ['choropleth-fill', 'choropleth-outline'];
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

function equalIntervalThresholds(values, classCount) {
  const minimum = values[0];
  const maximum = values[values.length - 1];
  if (minimum === maximum) return [];
  return Array.from({ length: classCount - 1 }, (_, index) => (
    minimum + ((maximum - minimum) * (index + 1)) / classCount
  ));
}

function quantileThresholds(values, classCount) {
  return Array.from({ length: classCount - 1 }, (_, index) => {
    const position = ((values.length - 1) * (index + 1)) / classCount;
    const lower = Math.floor(position);
    const fraction = position - lower;
    return values[lower] + ((values[Math.min(lower + 1, values.length - 1)] - values[lower]) * fraction);
  });
}

function jenksThresholds(values, classCount) {
  if (classCount <= 1 || values.length <= 1) return [];
  const count = values.length;
  const lower = Array.from({ length: count + 1 }, () => Array(classCount + 1).fill(0));
  const variance = Array.from({ length: count + 1 }, () => Array(classCount + 1).fill(Infinity));
  for (let group = 1; group <= classCount; group += 1) {
    lower[1][group] = 1;
    variance[1][group] = 0;
  }
  for (let length = 2; length <= count; length += 1) {
    let sum = 0;
    let sumSquares = 0;
    let weight = 0;
    for (let offset = 1; offset <= length; offset += 1) {
      const start = length - offset + 1;
      const value = values[start - 1];
      weight += 1;
      sum += value;
      sumSquares += value * value;
      const currentVariance = sumSquares - ((sum * sum) / weight);
      const previous = start - 1;
      if (previous === 0) continue;
      for (let group = 2; group <= classCount; group += 1) {
        const candidate = currentVariance + variance[previous][group - 1];
        if (candidate < variance[length][group]) {
          lower[length][group] = start;
          variance[length][group] = candidate;
        }
      }
    }
    lower[length][1] = 1;
    variance[length][1] = sumSquares - ((sum * sum) / weight);
  }
  const breaks = [];
  let end = count;
  for (let group = classCount; group > 1; group -= 1) {
    const start = lower[end][group];
    if (!start) return quantileThresholds(values, classCount);
    breaks.unshift(values[start - 1]);
    end = start - 1;
  }
  return breaks;
}

function sampleColors(colors, count) {
  if (count === 1) return [colors[Math.floor(colors.length / 2)]];
  return Array.from({ length: count }, (_, index) => (
    colors[Math.round((index * (colors.length - 1)) / (count - 1))]
  ));
}

function analyzeChoroplethValues(features, visualization) {
  const source = features ?? [];
  const field = visualization?.choroplethField;
  const mode = visualization?.choroplethNormalization || 'none';
  const denominatorField = visualization?.choroplethDenominatorField;
  const rateScale = Number(visualization?.choroplethRateScale) || 1;
  const raw = source.map((feature, index) => ({
    feature,
    index,
    value: feature.properties?.[field],
  })).filter((entry) => Number.isFinite(entry.value));
  const byIndex = new Map();
  let formula = field || 'Value';
  let unit = '';

  if (mode === 'field') {
    for (const entry of raw) {
      const denominator = entry.feature.properties?.[denominatorField];
      if (!Number.isFinite(denominator) || denominator <= 0) continue;
      byIndex.set(entry.index, (entry.value / denominator) * rateScale);
    }
    formula = `${field} ÷ ${denominatorField}${rateScale === 1 ? '' : ` × ${formatCompact(rateScale)}`}`;
    unit = rateScale === 100 ? '%' : rateScale === 1 ? '' : ` per ${formatCompact(rateScale)}`;
  } else if (mode === 'percent-total') {
    const total = raw.reduce((sum, entry) => sum + entry.value, 0);
    if (Number.isFinite(total) && total !== 0) {
      for (const entry of raw) byIndex.set(entry.index, (entry.value / total) * 100);
    }
    formula = `${field} ÷ layer total × 100`;
    unit = '%';
  } else if (mode === 'z-score') {
    const mean = raw.reduce((sum, entry) => sum + entry.value, 0) / Math.max(raw.length, 1);
    const variance = raw.reduce((sum, entry) => sum + ((entry.value - mean) ** 2), 0) / Math.max(raw.length, 1);
    const deviation = Math.sqrt(variance);
    for (const entry of raw) byIndex.set(entry.index, deviation === 0 ? 0 : (entry.value - mean) / deviation);
    formula = `(${field} − mean) ÷ standard deviation`;
    unit = ' z';
  } else if (mode === 'area') {
    const squareMiles = visualization?.choroplethAreaUnit === 'square-miles';
    for (const entry of raw) {
      const squareKilometers = geometryAreaSquareKilometers(entry.feature.geometry);
      const area = squareMiles ? squareKilometers * 0.3861021585 : squareKilometers;
      if (!Number.isFinite(area) || area <= 0) continue;
      byIndex.set(entry.index, entry.value / area);
    }
    formula = `${field} ÷ geodesic area`;
    unit = squareMiles ? ' per mi²' : ' per km²';
  } else {
    for (const entry of raw) byIndex.set(entry.index, entry.value);
  }

  const values = [...byIndex.entries()]
    .map(([index, value]) => ({ index, value }))
    .filter((entry) => Number.isFinite(entry.value));
  return { values, byIndex, formula, unit };
}

function geometryAreaSquareKilometers(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return NaN;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const squareMeters = polygons.reduce((total, polygon) => {
    if (!polygon?.length) return total;
    const outer = Math.abs(sphericalRingArea(polygon[0]));
    const holes = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(sphericalRingArea(ring)), 0);
    return total + Math.max(0, outer - holes);
  }, 0);
  return squareMeters / 1_000_000;
}

function sphericalRingArea(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return 0;
  const radius = 6_371_008.8;
  let sum = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    const current = coordinates[index];
    const next = coordinates[(index + 1) % coordinates.length];
    const latitude1 = degreesToRadians(current[1]);
    const latitude2 = degreesToRadians(next[1]);
    let longitudeDelta = degreesToRadians(next[0] - current[0]);
    if (longitudeDelta > Math.PI) longitudeDelta -= Math.PI * 2;
    if (longitudeDelta < -Math.PI) longitudeDelta += Math.PI * 2;
    sum += longitudeDelta * (2 + Math.sin(latitude1) + Math.sin(latitude2));
  }
  return (sum * radius * radius) / 2;
}

function degreesToRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function formatClassRange(minimum, maximum, finalClass, unit = '') {
  if (minimum === maximum) return `${formatChoroplethNumber(minimum)}${unit}`;
  return finalClass
    ? `${formatChoroplethNumber(minimum)} – ${formatChoroplethNumber(maximum)}${unit}`
    : `${formatChoroplethNumber(minimum)} – < ${formatChoroplethNumber(maximum)}${unit}`;
}

function formatChoroplethNumber(value) {
  const absolute = Math.abs(value);
  return new Intl.NumberFormat(undefined, absolute > 0 && absolute < 1
    ? { maximumSignificantDigits: 4 }
    : { maximumFractionDigits: 2 }).format(value);
}

function formatCompact(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
