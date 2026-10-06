import { useEffect, useRef, useState } from 'react';
import { FaGithub } from 'react-icons/fa';

const DRAW_ACTIONS = [
  { type: 'select', label: 'Select', icon: '↖' },
  { type: 'point', label: 'Point', icon: '●' },
  { type: 'line', label: 'Line', icon: '╱' },
  { type: 'polygon', label: 'Polygon', icon: '⬡' },
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'circle', label: 'Circle', icon: '○' },
];

const geometryIcon = { Point: '●', LineString: '╱', Polygon: '⬡' };

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-title">
        <span className="brand-mark" aria-hidden="true">⌖</span>
        <strong>Bottle of Rhumb</strong>
      </div>

      <nav className="header-actions" aria-label="Project links">
        <a
          className="header-link"
          href="https://github.com/chadlanoway/Bottle_Of_Rhumb"
          target="_blank"
          rel="noopener noreferrer"
          title="View Bottle of Rhumb on GitHub"
          aria-label="View Bottle of Rhumb on GitHub"
        >
          <FaGithub aria-hidden="true" />
        </a>

        <button
          className="donate-button"
          type="button"
          disabled
          title="Coming later"
        >
          Donate
        </button>
      </nav>
    </header>
  );
}

export function EditorToolbar({
  activeLayer,
  disabled,
  featureCount,
  onDelete,
  onDraw,
  onSetView,
  viewSaved,
}) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Map drawing tools">
      <div className="tool-group">
        {DRAW_ACTIONS.map((action) => (
          <button
            className="tool-button"
            disabled={disabled}
            key={action.type}
            type="button"
            onClick={() => onDraw(action.type)}
            title={action.label}
          >
            <span aria-hidden="true">{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-divider" />
      <button className={`tool-button view-tool ${viewSaved ? 'is-saved' : ''}`} disabled={disabled} type="button" onClick={onSetView} title="Save the opening view for the shared map">
        <FrameIcon />
        <span>{viewSaved ? 'View saved' : 'Set view'}</span>
      </button>
      <div className="toolbar-divider" />
      <button className="tool-button danger-tool" disabled={disabled} type="button" onClick={onDelete}>
        <span aria-hidden="true">⌫</span><span>Delete</span>
      </button>
      <div className="active-layer-status" title="New features will be added to this layer">
        <span>Drawing on</span>
        <strong>{activeLayer?.name ?? 'No active layer'}</strong>
      </div>
      <span className="toolbar-feature-count">{featureCount} features</span>
    </div>
  );
}

export default function Menu({
  activeLayerId,
  disabled,
  features,
  layers,
  savedView,
  selectedFeatureId,
  viewMessage,
  onAddLayer,
  onApplyGeoJSON,
  onClearView,
  onDeleteLayer,
  onExport,
  onImport,
  onFitToFeatures,
  onLayerChange,
  onRenameLayer,
  onPreviewView,
  onSaveView,
  onSelectFeature,
  onToggleLayer,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState('layers');
  const fileInputRef = useRef(null);

  async function handleFileChange(event) {
    const [file] = event.target.files;
    if (file) await onImport(file);
    event.target.value = '';
  }

  return (
    <aside className={`app-menu ${collapsed ? 'app-menu--collapsed' : ''}`}>
      <div className="panel-heading">
        <strong>{collapsed ? '' : 'Map editor'}</strong>
        <button
          className="icon-button"
          type="button"
          title={collapsed ? 'Open panel' : 'Collapse panel'}
          aria-label={collapsed ? 'Open panel' : 'Collapse panel'}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {!collapsed && (
        <>
          <nav className="menu-tabs" aria-label="Map editor sections">
            {['layers', 'map', 'data', 'share'].map((section) => (
              <button
                className={activeSection === section ? 'is-active' : ''}
                key={section}
                type="button"
                onClick={() => setActiveSection(section)}
              >
                {section}
              </button>
            ))}
          </nav>

          {activeSection === 'layers' && (
            <LayersSection
              activeLayerId={activeLayerId}
              features={features}
              layers={layers}
              selectedFeatureId={selectedFeatureId}
              onAddLayer={onAddLayer}
              onDeleteLayer={onDeleteLayer}
              onLayerChange={onLayerChange}
              onRenameLayer={onRenameLayer}
              onSelectFeature={onSelectFeature}
              onToggleLayer={onToggleLayer}
            />
          )}

          {activeSection === 'data' && (
            <DataSection
              disabled={disabled}
              features={features}
              fileInputRef={fileInputRef}
              onApplyGeoJSON={onApplyGeoJSON}
              onExport={onExport}
              onFileChange={handleFileChange}
            />
          )}

          {activeSection === 'map' && (
            <MapSection
              disabled={disabled}
              savedView={savedView}
              viewMessage={viewMessage}
              onClearView={onClearView}
              onFitToFeatures={onFitToFeatures}
              onPreviewView={onPreviewView}
              onSaveView={onSaveView}
            />
          )}

          {activeSection === 'share' && (
            <div className="menu-section empty-section">
              <span className="coming-soon">Coming next</span>
              <h2>{activeSection}</h2>
              <p>Saving, screenshots, links, and embed code will live here.</p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function DataSection({
  disabled,
  features,
  fileInputRef,
  onApplyGeoJSON,
  onExport,
  onFileChange,
}) {
  const initialText = formatCollection(features);
  const [geoJSONText, setGeoJSONText] = useState(initialText);
  const [message, setMessage] = useState('GeoJSON is valid.');
  const editorRef = useRef(null);
  const suppressMapSyncUntilRef = useRef(0);

  useEffect(() => {
    if (Date.now() < suppressMapSyncUntilRef.current) return;
    const formatted = formatCollection(features);
    setGeoJSONText(formatted);
    setMessage('Map changes synced to GeoJSON.');
  }, [features]);

  function formatEditor() {
    try {
      setGeoJSONText(JSON.stringify(JSON.parse(geoJSONText), null, 2));
      setMessage('GeoJSON formatted.');
    } catch (error) {
      setMessage(`Cannot format: ${error.message}`);
    }
  }

  function updateEditor(value) {
    setGeoJSONText(value);
    try {
      const collection = JSON.parse(value);
      const result = onApplyGeoJSON(collection);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      suppressMapSyncUntilRef.current = Date.now() + 250;
      setMessage('GeoJSON is valid. Map updated.');
    } catch (error) {
      setMessage(`Invalid JSON: ${error.message}`);
    }
  }

  function resetEditor() {
    const formatted = formatCollection(features);
    setGeoJSONText(formatted);
    setMessage('Restored the last valid map data.');
  }

  async function copyEditor() {
    await navigator.clipboard.writeText(geoJSONText);
    setMessage('GeoJSON copied.');
  }

  return (
    <div className="menu-section data-section">
      <p className="section-label">Import / export</p>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        onChange={onFileChange}
      />
      <div className="button-row">
        <button className="secondary-button" disabled={disabled} type="button" onClick={() => fileInputRef.current?.click()}>Import layer</button>
        <button className="secondary-button" disabled={disabled || features.length === 0} type="button" onClick={onExport}>Export</button>
      </div>
      <p className="data-drop-help">You can also drop a GeoJSON file directly onto the map.</p>

      <div className="map-settings-divider" />
      <p className="section-label">GeoJSON editor</p>
      <textarea
        ref={editorRef}
        className="geojson-editor"
        aria-label="GeoJSON editor"
        spellCheck="false"
        value={geoJSONText}
        onChange={(event) => updateEditor(event.target.value)}
      />
      <div className="geojson-editor-actions">
        <button type="button" onClick={formatEditor}>Format</button>
        <button type="button" onClick={copyEditor}>Copy</button>
        <button type="button" onClick={resetEditor}>Reset</button>
      </div>
      {message && <p className={`geojson-message ${message.startsWith('Invalid') || message.startsWith('Cannot') || message.startsWith('Feature') ? 'is-error' : ''}`} role="status">{message}</p>}
    </div>
  );
}

function formatCollection(features) {
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

function MapSection({
  disabled,
  savedView,
  viewMessage,
  onClearView,
  onFitToFeatures,
  onPreviewView,
  onSaveView,
}) {
  return (
    <div className="menu-section map-section">
      <p className="section-label">Opening view</p>
      <p className="section-help">This is what viewers will see when the shared map opens.</p>

      <button className="primary-map-button" disabled={disabled} type="button" onClick={onSaveView}>
        <FrameIcon />
        Use current map view
      </button>
      <button className="secondary-button map-action-button" disabled={disabled} type="button" onClick={onFitToFeatures}>
        Fit to visible features
      </button>

      {savedView ? (
        <div className="saved-view-card">
          <div className="saved-view-heading">
            <span className="saved-check" aria-hidden="true">✓</span>
            <strong>Opening view saved</strong>
          </div>
          <dl>
            <div><dt>Center</dt><dd>{savedView.center[1].toFixed(4)}, {savedView.center[0].toFixed(4)}</dd></div>
            <div><dt>Zoom</dt><dd>{savedView.zoom.toFixed(1)}</dd></div>
            <div><dt>Bearing</dt><dd>{savedView.bearing.toFixed(0)}°</dd></div>
            <div><dt>Pitch</dt><dd>{savedView.pitch.toFixed(0)}°</dd></div>
          </dl>
          <div className="saved-view-actions">
            <button type="button" onClick={onPreviewView}>Preview</button>
            <button className="clear-view-button" type="button" onClick={onClearView}>Clear</button>
          </div>
        </div>
      ) : (
        <div className="view-not-saved">No opening view saved. Published maps can automatically fit to visible features.</div>
      )}

      {viewMessage && <p className="view-message" role="status">{viewMessage}</p>}

      <div className="map-settings-divider" />
      <span className="coming-soon">Coming next</span>
      <h2>Legend and basemap</h2>
      <p className="section-help">Legend position, layer labels, and basemap selection will be added here.</p>
    </div>
  );
}

function LayersSection({
  activeLayerId,
  features,
  layers,
  selectedFeatureId,
  onAddLayer,
  onDeleteLayer,
  onLayerChange,
  onRenameLayer,
  onSelectFeature,
  onToggleLayer,
}) {
  return (
    <div className="menu-section layers-section">
      <div className="section-heading-row">
        <p className="section-label">Layers</p>
        <button className="small-button" type="button" onClick={onAddLayer}>+ Add</button>
      </div>
      <div className="layer-list">
        {layers.map((layer) => {
          const layerFeatures = features.filter(
            (feature) => (feature.properties?.layerId ?? layers[0]?.id) === layer.id,
          );
          const active = layer.id === activeLayerId;

          return (
            <section className={`layer-card ${active ? 'is-active' : ''}`} key={layer.id}>
              <div className="layer-row">
                <span className="active-layer-dot" aria-hidden="true" />
                <button
                  className={`visibility-button ${layer.visible ? '' : 'is-hidden'}`}
                  type="button"
                  title={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  aria-pressed={!layer.visible}
                  onClick={() => onToggleLayer(layer.id)}
                >
                  <EyeIcon hidden={!layer.visible} />
                </button>
                <button className="layer-select-button" type="button" onClick={() => onLayerChange(layer.id)}>
                  <span className="layer-geometry" aria-hidden="true">◇</span>
                  <strong>{layer.name}</strong>
                </button>
                <span className="layer-count">{layerFeatures.length}</span>
                <button
                  className="delete-layer-icon"
                  disabled={layers.length === 1}
                  type="button"
                  title={layers.length === 1 ? 'A map must have at least one layer' : `Delete ${layer.name}`}
                  aria-label={layers.length === 1 ? 'The final layer cannot be deleted' : `Delete ${layer.name}`}
                  onClick={() => onDeleteLayer(layer.id)}
                >
                  <TrashIcon />
                </button>
              </div>
              {active && (
                <div className="layer-details">
                  <label className="field-label" htmlFor={`layer-${layer.id}`}>Layer name</label>
                  <input id={`layer-${layer.id}`} value={layer.name} onChange={(event) => onRenameLayer(layer.id, event.target.value)} />
                  <p className="section-label feature-list-label">Features</p>
                  {layerFeatures.length === 0 ? (
                    <p className="empty-message">Use the toolbar to draw the first feature.</p>
                  ) : (
                    <div className="feature-list">
                      {layerFeatures.map((feature, index) => (
                        <button
                          className={String(feature.id) === String(selectedFeatureId) ? 'is-selected' : ''}
                          key={feature.id}
                          type="button"
                          onClick={() => onSelectFeature(feature.id)}
                        >
                          <span aria-hidden="true">{featureIcon(feature)}</span>
                          <span>{featureListName(feature, index)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

    </div>
  );
}

function featureIcon(feature) {
  if (feature.properties?.featureType === 'text') return 'T';
  return geometryIcon[feature.geometry?.type] ?? '◇';
}

function featureListName(feature, index) {
  if (feature.properties?.featureType === 'text') {
    return feature.properties?.text?.trim() || `Text ${index + 1}`;
  }
  return feature.properties?.name || `${feature.geometry?.type} ${index + 1}`;
}

function EyeIcon({ hidden }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2.3 12s3.5-6 9.7-6 9.7 6 9.7 6-3.5 6-9.7 6-9.7-6-9.7-6Z" />
      <circle cx="12" cy="12" r="2.8" />
      {hidden && <path className="eye-slash" d="M4 4 20 20" />}
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg className="frame-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </svg>
  );
}
