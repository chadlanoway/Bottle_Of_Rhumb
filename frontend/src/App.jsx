import { useEffect, useRef, useState } from 'react';
import Menu, { AppHeader, EditorToolbar } from './Menu.jsx';
import FeatureEditor from './FeatureEditor.jsx';
import { createMap, fitMapToFeatures, getMapView, previewMapView } from './map.js';
import {
  addGeoJSON,
  deleteSelected,
  deleteFeature,
  deleteLayerFeatures,
  exportGeoJSON,
  previewFeaturePopup,
  replaceGeoJSON,
  selectFeature,
  setHiddenLayers,
  setupDrawingTools,
  startDrawing,
  updateFeature,
} from './drawing-tools.js';

const DEFAULT_LAYER = { id: 'default-layer', name: 'Untitled layer', visible: true };

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
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);
  const [savedView, setSavedView] = useState(null);
  const [viewMessage, setViewMessage] = useState('');
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  activeLayerIdRef.current = activeLayerId;

  useEffect(() => {
    const hiddenLayerIds = layers
      .filter((layer) => !layer.visible)
      .map((layer) => layer.id);
    mapRef.current?.rhumbWeatherControl?.setFeatures(
      features,
      hiddenLayerIds,
      selectedFeatureId,
    );
  }, [features, layers, selectedFeatureId]);

  useEffect(() => {
    let map;

    try {
      map = createMap(mapContainerRef.current);
      mapRef.current = map;
      map.on('load', () => {
        drawRef.current = setupDrawingTools(
          map,
          (collection) => setFeatures(collection.features),
          () => activeLayerIdRef.current,
          setSelectedFeatureId,
        );
        setMapReady(true);
      });
      map.on('error', (event) => {
        if (event.error) setError(event.error.message);
      });
    } catch (caughtError) {
      setError(caughtError.message);
    }

    return () => map?.remove();
  }, []);

  function handleDraw(type) {
    setError('');
    setSelectedFeatureId(null);
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
      setLayers((current) => [...current, { id: layerId, name, visible: true }]);
      setActiveLayerId(layerId);
      setSelectedFeatureId(null);
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
      setSelectedFeatureId(null);
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
          missing.push({ id, name: `Imported layer ${missing.length + 1}`, visible: true });
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
      { id, name: `Layer ${current.length + 1}`, visible: true },
    ]);
    setActiveLayerId(id);
  }

  function handleSelectFeature(id) {
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    setSelectedFeatureId(id);
    selectFeature(drawRef.current, id);
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
    if (selectedFeatureId === null) {
      deleteSelected(drawRef.current);
      return;
    }

    deleteFeature(drawRef.current, selectedFeatureId);
    setSelectedFeatureId(null);
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
    setSelectedFeatureId(null);
    setHiddenLayers(
      drawRef.current,
      mapRef.current,
      nextLayers.filter((candidate) => !candidate.visible).map((candidate) => candidate.id),
    );
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

  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
  const selectedFeature = features.find(
    (feature) => String(feature.id) === String(selectedFeatureId),
  );

  return (
    <main
      className={`app-shell ${dragActive ? 'is-dragging-file' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div ref={mapContainerRef} className="map-canvas" />
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
        disabled={!mapReady}
        features={features}
        layers={layers}
        selectedFeatureId={selectedFeatureId}
        savedView={savedView}
        viewMessage={viewMessage}
        onAddLayer={handleAddLayer}
        onExport={() => exportGeoJSON(drawRef.current)}
        onImport={handleImport}
        onApplyGeoJSON={handleApplyGeoJSON}
        onClearView={handleClearView}
        onDeleteLayer={handleDeleteLayer}
        onLayerChange={setActiveLayerId}
        onRenameLayer={(id, name) => setLayers((current) => current.map(
          (layer) => (layer.id === id ? { ...layer, name } : layer),
        ))}
        onSelectFeature={handleSelectFeature}
        onFitToFeatures={handleFitToFeatures}
        onPreviewView={handlePreviewView}
        onSaveView={handleSaveView}
        onToggleLayer={handleToggleLayer}
      />
      <FeatureEditor
        feature={selectedFeature}
        onDelete={handleDeleteFeature}
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
          <strong>Map error</strong>
          <span>{error}</span>
        </div>
      )}
    </main>
  );
}

function hasFileTransfer(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isGeoJSONFile(file) {
  return /\.(geojson|json)$/i.test(file.name);
}
