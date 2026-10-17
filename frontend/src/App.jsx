import { useEffect, useRef, useState } from 'react';
import Menu, { AppHeader, EditorToolbar } from './Menu.jsx';
import FeatureEditor from './FeatureEditor.jsx';
import {
  BASEMAPS,
  createMap,
  fitMapToFeatures,
  getMapView,
  previewMapView,
} from './map.js';
import {
  addDerivedGeoJSON,
  addGeoJSON,
  deleteFeatures,
  deleteLayerFeatures,
  exportGeoJSON,
  previewFeaturePopup,
  replaceGeoJSON,
  restoreGeoJSON,
  selectFeature,
  setHiddenLayers,
  setMultiSelectedFeatures,
  setupDrawingTools,
  startDrawing,
  updateFeature,
} from './drawing-tools.js';
import { runGeometryOperation } from './geometry-operations.js';

const LEGEND_COLORS = ['#1e90ff', '#e06c5b', '#45a36f', '#9b72cf', '#d49a36', '#2ba6a6'];

function makeLayer(id, name, index = 0) {
  return {
    id,
    name,
    visible: true,
    showInLegend: true,
    legendLabel: name,
    legendColor: LEGEND_COLORS[index % LEGEND_COLORS.length],
  };
}

const DEFAULT_LAYER = makeLayer('default-layer', 'Untitled layer');

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const activeLayerIdRef = useRef(DEFAULT_LAYER.id);
  const dragDepthRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [features, setFeatures] = useState([]);
  const [layers, setLayers] = useState([DEFAULT_LAYER]);
  const [activeLayerId, setActiveLayerId] = useState(DEFAULT_LAYER.id);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState([]);
  const [savedView, setSavedView] = useState(null);
  const [viewMessage, setViewMessage] = useState('');
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [basemapId, setBasemapId] = useState('positron');
  const [legend, setLegend] = useState({
    visible: true,
    title: 'Legend',
    position: 'top-right',
    backgroundColor: '#ffffff',
    backgroundOpacity: 94,
    textColor: '#172229',
    fontFamily: 'sans',
    glowEnabled: false,
    glowColor: '#1e90ff',
    glowSize: 18,
  });

  activeLayerIdRef.current = activeLayerId;
  const selectedFeatureId = selectedFeatureIds.at(-1) ?? null;

  useEffect(() => {
    const hiddenLayerIds = layers
      .filter((layer) => !layer.visible)
      .map((layer) => layer.id);
    mapRef.current?.rhumbWeatherControl?.setFeatures(
      features,
      hiddenLayerIds,
      selectedFeatureId,
    );
    setMultiSelectedFeatures(mapRef.current, features, selectedFeatureIds);
  }, [features, layers, selectedFeatureId, selectedFeatureIds]);

  useEffect(() => {
    try {
      mountMap(basemapId, [], [DEFAULT_LAYER], null);
    } catch (caughtError) {
      setError(caughtError.message);
    }

    return () => mapRef.current?.remove();
  }, []);

  function mountMap(nextBasemapId, restoredFeatures, restoredLayers, restoredSelection) {
    const map = createMap(mapContainerRef.current, nextBasemapId);
    mapRef.current = map;

    map.on('load', () => {
      const draw = setupDrawingTools(
        map,
        (collection) => setFeatures(collection.features),
        () => activeLayerIdRef.current,
        handleSelectionChange,
      );
      drawRef.current = draw;

      if (restoredFeatures.length > 0) {
        restoreGeoJSON(
          draw,
          { type: 'FeatureCollection', features: restoredFeatures },
          activeLayerIdRef.current,
        );
      }

      const hiddenLayerIds = restoredLayers
        .filter((layer) => !layer.visible)
        .map((layer) => layer.id);
      setHiddenLayers(draw, map, hiddenLayerIds);

      const restoredPrimary = restoredSelection?.at?.(-1) ?? restoredSelection ?? null;
      if (restoredPrimary !== null && restoredPrimary !== undefined) {
        try {
          selectFeature(draw, restoredPrimary);
        } catch {
          setSelectedFeatureIds([]);
        }
      }

      setMultiSelectedFeatures(map, restoredFeatures, restoredSelection ?? []);

      map.rhumbWeatherControl?.setFeatures(
        restoredFeatures,
        hiddenLayerIds,
        restoredPrimary,
      );
      setMapReady(true);
    });

    map.on('error', (event) => {
      if (event.error) setError(event.error.message);
    });
  }

  function handleDraw(type) {
    setError('');
    setSelectedFeatureIds([]);
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    startDrawing(drawRef.current, type);
  }

  async function handleImport(file) {
    try {
      setError('');
      const collection = JSON.parse(await file.text());
      const layerId = `layer-${crypto.randomUUID()}`;
      const loaded = addGeoJSON(
        drawRef.current,
        mapRef.current,
        collection,
        layerId,
      );
      const name = file.name.replace(/\.(geojson|json)$/i, '') || 'Imported layer';
      setLayers((current) => [...current, makeLayer(layerId, name, current.length)]);
      setActiveLayerId(layerId);
      setSelectedFeatureIds([]);
      setFeatures(loaded.features);
      return { ok: true };
    } catch (caughtError) {
      setError(caughtError.message);
      return { ok: false, error: caughtError.message };
    }
  }

  function handleApplyGeoJSON(collection) {
    try {
      setError('');
      const loaded = replaceGeoJSON(
        drawRef.current,
        mapRef.current,
        collection,
        activeLayerId,
      );
      setFeatures(loaded.features);
      setSelectedFeatureIds([]);
      addMissingLayers(loaded.features);
      return { ok: true };
    } catch (caughtError) {
      setError(caughtError.message);
      return { ok: false, error: caughtError.message };
    }
  }

  function addMissingLayers(nextFeatures) {
    setLayers((current) => {
      const known = new Set(current.map((layer) => layer.id));
      const missing = [];
      for (const feature of nextFeatures) {
        const id = feature.properties?.layerId ?? activeLayerId;
        if (!known.has(id)) {
          known.add(id);
          const name = `Imported layer ${missing.length + 1}`;
          missing.push(makeLayer(id, name, current.length + missing.length));
        }
      }
      return [...current, ...missing];
    });
  }

  function handleDragEnter(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  async function handleDrop(event) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const file = Array.from(event.dataTransfer.files).find(isGeoJSONFile);
    if (!file) {
      setError('Drop a .geojson or .json file to import it as a new layer.');
      return;
    }
    await handleImport(file);
  }

  function handleAddLayer() {
    const id = `layer-${crypto.randomUUID()}`;
    setLayers((current) => [
      ...current,
      makeLayer(id, `Layer ${current.length + 1}`, current.length),
    ]);
    setActiveLayerId(id);
  }

  function handleSelectFeature(id) {
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    selectFeature(drawRef.current, id);
  }

  function handleSelectionChange(id, { additive = false } = {}) {
    if (id === null || id === undefined) {
      if (!additive) setSelectedFeatureIds([]);
      return;
    }

    setSelectedFeatureIds((current) => {
      if (!additive) return [id];
      const alreadySelected = current.some((candidate) => String(candidate) === String(id));
      return alreadySelected
        ? [...current.filter((candidate) => String(candidate) !== String(id)), id]
        : [...current, id];
    });
  }

  function handleToggleLayer(id) {
    setLayers((current) => {
      const next = current.map((layer) => (
        layer.id === id ? { ...layer, visible: !layer.visible } : layer
      ));
      const hiddenIds = next.filter((layer) => !layer.visible).map((layer) => layer.id);
      setHiddenLayers(drawRef.current, mapRef.current, hiddenIds);
      return next;
    });
  }

  function handleDeleteFeature() {
    if (selectedFeatureIds.length === 0) return;
    deleteFeatures(drawRef.current, selectedFeatureIds);
    setSelectedFeatureIds([]);
  }

  function handleDeleteLayer(id) {
    const layer = layers.find((candidate) => candidate.id === id);
    if (!layer || layers.length === 1) return;

    const layerFeatureCount = features.filter(
      (feature) => feature.properties?.layerId === id,
    ).length;
    const message = layerFeatureCount > 0
      ? `Delete “${layer.name}” and its ${layerFeatureCount} feature${layerFeatureCount === 1 ? '' : 's'}?`
      : `Delete “${layer.name}”?`;

    if (!window.confirm(message)) return;

    deleteLayerFeatures(drawRef.current, id);
    const nextLayers = layers.filter((candidate) => candidate.id !== id);
    const nextActiveId = activeLayerId === id ? nextLayers[0].id : activeLayerId;

    setLayers(nextLayers);
    setActiveLayerId(nextActiveId);
    setSelectedFeatureIds([]);
    setHiddenLayers(
      drawRef.current,
      mapRef.current,
      nextLayers.filter((candidate) => !candidate.visible).map((candidate) => candidate.id),
    );
  }

  function handleGeometryOperation(operation, options) {
    try {
      setError('');
      if (selectedFeatures.length === 0) throw new Error('Select at least one feature first.');
      const derived = runGeometryOperation(selectedFeatures, operation, options);
      const layerId = selectedFeature.properties?.layerId ?? activeLayerId;
      const added = addDerivedGeoJSON(drawRef.current, derived, layerId);
      setFeatures(added.collection.features);
      return { ok: true, message: derived.message };
    } catch (caughtError) {
      setError(caughtError.message);
      return { ok: false, message: caughtError.message };
    }
  }

  function handleSaveView() {
    if (!mapRef.current) return;
    setSavedView(getMapView(mapRef.current));
    setViewMessage('Opening view saved.');
  }

  function handleFitToFeatures() {
    const visibleLayerIds = new Set(
      layers.filter((layer) => layer.visible).map((layer) => layer.id),
    );
    const visibleFeatures = features.filter((feature) => (
      visibleLayerIds.has(feature.properties?.layerId ?? layers[0]?.id)
    ));
    const started = fitMapToFeatures(mapRef.current, visibleFeatures, (view) => {
      setSavedView(view);
      setViewMessage('Visible features fitted and opening view saved.');
    });

    if (!started) setViewMessage('There are no visible features to fit.');
  }

  function handlePreviewView() {
    previewMapView(mapRef.current, savedView);
    setViewMessage('Showing the saved opening view.');
  }

  function handleClearView() {
    setSavedView(null);
    setViewMessage('Saved opening view cleared.');
  }

  function handleBasemapChange(nextId) {
    if (!mapRef.current || nextId === basemapId) return;
    setError('');
    const restoredFeatures = features.map((feature) => structuredClone(feature));
    const restoredLayers = layers.map((layer) => ({ ...layer }));
    const restoredSelection = [...selectedFeatureIds];

    setMapReady(false);
    mapRef.current.rhumbWeatherControl?.disableWeather();
    mapRef.current.remove();
    drawRef.current = null;
    mapRef.current = null;
    mapContainerRef.current?.replaceChildren();

    mountMap(nextId, restoredFeatures, restoredLayers, restoredSelection);
    setBasemapId(nextId);
  }

  function handleLegendChange(changes) {
    setLegend((current) => ({ ...current, ...changes }));
  }

  function handleLegendLayerChange(id, changes) {
    setLayers((current) => current.map((layer) => (
      layer.id === id ? { ...layer, ...changes } : layer
    )));
  }

  function handleRenameLayer(id, name) {
    setLayers((current) => current.map((layer) => {
      if (layer.id !== id) return layer;
      const previousDefault = !layer.legendLabel || layer.legendLabel === layer.name;
      return {
        ...layer,
        name,
        legendLabel: previousDefault ? name : layer.legendLabel,
      };
    }));
  }

  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
  const selectedFeature = features.find(
    (feature) => String(feature.id) === String(selectedFeatureId),
  );
  const selectedFeatures = selectedFeatureIds
    .map((id) => features.find((feature) => String(feature.id) === String(id)))
    .filter(Boolean);

  return (
    <main
      className={`app-shell ${dragActive ? 'is-dragging-file' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div ref={mapContainerRef} className="map-canvas" />
      <MapLegend legend={legend} layers={layers} features={features} />
      <AppHeader />
      <EditorToolbar
        activeLayer={activeLayer}
        disabled={!mapReady}
        featureCount={features.length}
        onDelete={handleDeleteFeature}
        onDraw={handleDraw}
        onSetView={handleSaveView}
        viewSaved={Boolean(savedView)}
      />
      <Menu
        activeLayerId={activeLayerId}
        basemapId={basemapId}
        basemaps={BASEMAPS}
        disabled={!mapReady}
        features={features}
        layers={layers}
        legend={legend}
        selectedFeatureId={selectedFeatureId}
        savedView={savedView}
        viewMessage={viewMessage}
        onAddLayer={handleAddLayer}
        onBasemapChange={handleBasemapChange}
        onExport={() => exportGeoJSON(drawRef.current)}
        onImport={handleImport}
        onApplyGeoJSON={handleApplyGeoJSON}
        onClearView={handleClearView}
        onDeleteLayer={handleDeleteLayer}
        onLayerChange={setActiveLayerId}
        onLegendChange={handleLegendChange}
        onLegendLayerChange={handleLegendLayerChange}
        onRenameLayer={handleRenameLayer}
        onSelectFeature={handleSelectFeature}
        onFitToFeatures={handleFitToFeatures}
        onPreviewView={handlePreviewView}
        onSaveView={handleSaveView}
        onToggleLayer={handleToggleLayer}
      />
      <FeatureEditor
        feature={selectedFeature}
        features={selectedFeatures}
        onDelete={handleDeleteFeature}
        onGeometryOperation={handleGeometryOperation}
        onPreview={() => previewFeaturePopup(drawRef.current, mapRef.current, selectedFeatureId)}
        onUpdate={(properties) => updateFeature(drawRef.current, selectedFeatureId, properties)}
      />

      {dragActive && (
        <div className="geojson-drop-overlay" aria-hidden="true">
          <div>
            <strong>Drop GeoJSON to add a layer</strong>
            <span>The existing map will be preserved.</span>
          </div>
        </div>
      )}

      {!mapReady && !error && (
        <div className="loading-card" role="status">
          <div className="loading-compass">⌖</div>
          <span>Loading chart…</span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <div className="error-banner-heading">
            <strong>Map error</strong>
            <button type="button" aria-label="Dismiss map error" onClick={() => setError('')}>×</button>
          </div>
          <span>{error}</span>
        </div>
      )}
    </main>
  );
}

function MapLegend({ legend, layers, features }) {
  if (!legend.visible) return null;

  const entries = layers.filter((layer) => layer.visible && layer.showInLegend !== false);
  if (entries.length === 0) return null;

  return (
    <section
      className={`map-legend map-legend--${legend.position}`}
      aria-label={legend.title || 'Map legend'}
      style={{
        backgroundColor: hexToRgba(legend.backgroundColor, legend.backgroundOpacity / 100),
        color: legend.textColor,
        fontFamily: legendFontFamily(legend.fontFamily),
        boxShadow: legend.glowEnabled
          ? `0 0 ${legend.glowSize}px ${legend.glowColor}, 0 5px 18px rgba(0,0,0,.2)`
          : '0 5px 18px rgba(0,0,0,.2)',
      }}
    >
      {legend.title && <h2>{legend.title}</h2>}
      <div className="map-legend__items">
        {entries.map((layer) => {
          const layerFeatures = features.filter(
            (feature) => (feature.properties?.layerId ?? layers[0]?.id) === layer.id,
          );
          const symbol = getLegendSymbol(layerFeatures);
          return (
            <div className="map-legend__item" key={layer.id}>
              <LegendSymbol color={layer.legendColor} symbol={symbol} />
              <span>{layer.legendLabel || layer.name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LegendSymbol({ color, symbol }) {
  if (symbol === 'text') {
    return <span className="map-legend__text-symbol" style={{ color }} aria-hidden="true">T</span>;
  }
  return <span className={`map-legend__symbol is-${symbol}`} style={{ '--legend-color': color }} aria-hidden="true" />;
}

function getLegendSymbol(features) {
  if (features.some((feature) => feature.properties?.featureType === 'text')) return 'text';
  const geometryTypes = new Set(features.map((feature) => feature.geometry?.type));
  if (geometryTypes.size !== 1) return 'mixed';
  const [type] = geometryTypes;
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  return 'mixed';
}

function legendFontFamily(font) {
  if (font === 'serif') return 'Georgia, serif';
  if (font === 'mono') return 'Consolas, "Courier New", monospace';
  return 'Arial, Helvetica, sans-serif';
}

function hexToRgba(hex, opacity) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'ffffff';
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, opacity))})`;
}

function hasFileTransfer(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isGeoJSONFile(file) {
  return /\.(geojson|json)$/i.test(file.name);
}
