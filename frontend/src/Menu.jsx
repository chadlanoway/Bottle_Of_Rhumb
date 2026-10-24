import { useEffect, useRef, useState } from 'react';
import { FaGithub } from 'react-icons/fa';

const DRAW_ACTIONS = [
  { type: 'select', label: 'Select', icon: '↖' },
  { type: 'point', label: 'Point', icon: '●' },
  { type: 'line', label: 'Line', icon: '╱' },
  { type: 'polygon', label: 'Polygon', icon: '⬡' },
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'circle', label: 'Circle', icon: '○' },
  { type: 'quick-route', label: 'Quick route', icon: '⤳' },
  { type: 'land-route', label: 'Land route', icon: '⇢' },
];

const ROUTE_PROFILES = [
  { value: 'foot-walking', label: 'Walking' },
  { value: 'foot-hiking', label: 'Hiking' },
  { value: 'cycling-regular', label: 'Cycling' },
  { value: 'driving-car', label: 'Driving' },
];

const geometryIcon = { Point: '●', LineString: '╱', Polygon: '⬡' };

export function AppHeader({ onStartTutorial, tutorialActive = false }) {
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
          className={`header-tutorial-button ${tutorialActive ? 'is-active' : ''}`}
          type="button"
          title="Show the guided map-making demo"
          aria-label="Start guided tutorial"
          aria-pressed={tutorialActive}
          onClick={onStartTutorial}
        >
          ?
        </button>
      </nav>

      <style>{`
        .header-tutorial-button {
          display: grid;
          width: 32px;
          height: 32px;
          padding: 0;
          place-items: center;
          border: 1px solid #617d98;
          border-radius: 50%;
          background: #172f49;
          color: #f4f8fb;
          font: inherit;
          font-size: 17px;
          font-weight: 800;
          cursor: pointer;
          animation: rhumb-help-pulse 3s ease-in-out infinite;
        }

        .header-tutorial-button:hover,
        .header-tutorial-button:focus-visible,
        .header-tutorial-button.is-active {
          background: #214766;
          border-color: #9bb9d3;
        }

        .header-tutorial-button:focus-visible {
          outline: 2px solid #d6e8f7;
          outline-offset: 3px;
        }

        @keyframes rhumb-help-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(25, 62, 96, 0.25); }
          50% { box-shadow: 0 0 0 9px rgba(25, 62, 96, 0.7); }
        }

        @media (prefers-reduced-motion: reduce) {
          .header-tutorial-button { animation: none; }
        }
      `}</style>
    </header>
  );
}

export function EditorToolbar({
  activeLayer,
  disabled,
  featureCount,
  onAddSearchPoint,
  onAddressSearch,
  onLocateDevice,
  onCancelRouting,
  onDelete,
  onDraw,
  onPreviewSearchResult,
  onSetView,
  onStartRouting,
  onStartQuickRoute,
  onUseSearchAsRouteStart,
  routingActive,
  routingStatus,
  viewSaved,
  tutorialDrawMenuOpen = false,
}) {
  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  const [routeProfile, setRouteProfile] = useState('foot-walking');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const drawMenuRef = useRef(null);

  useEffect(() => {
    function closeDrawMenu(event) {
      if (!drawMenuRef.current?.contains(event.target)) setDrawMenuOpen(false);
    }
    document.addEventListener('pointerdown', closeDrawMenu);
    return () => document.removeEventListener('pointerdown', closeDrawMenu);
  }, []);

  useEffect(() => {
    setDrawMenuOpen(tutorialDrawMenuOpen);
  }, [tutorialDrawMenuOpen]);

  function chooseTool(type) {
    setDrawMenuOpen(false);
    if (type === 'land-route') onStartRouting(routeProfile);
    else if (type === 'quick-route') onStartQuickRoute();
    else onDraw(type);
  }

  async function submitSearch(event) {
    event.preventDefault();
    setSearching(true);
    setSearchMessage('');
    const result = await onAddressSearch(searchQuery);
    setSearching(false);
    setSearchResults(result.results ?? []);
    if (!result.ok) setSearchMessage(result.error);
    else if (!result.results?.length) setSearchMessage('No matching places found.');
  }

  function clearSearch() {
    setSearchResults([]);
    setSearchMessage('');
    setSearchQuery('');
  }

  async function locateDevice() {
    setLocating(true);
    await onLocateDevice();
    setLocating(false);
  }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Map drawing tools">
      <div className="drawing-tools-menu" ref={drawMenuRef}>
        <button
          className={`tool-button drawing-tools-trigger ${drawMenuOpen ? 'is-active' : ''}`}
          disabled={disabled}
          type="button"
          aria-expanded={drawMenuOpen}
          onClick={() => setDrawMenuOpen((value) => !value)}
        >
          <span aria-hidden="true">✎</span>
          <span>Drawing tools</span>
          <span aria-hidden="true">▾</span>
        </button>
        {drawMenuOpen && (
          <div className="drawing-tools-popover" role="menu">
            {DRAW_ACTIONS.map((action) => (
              <button
                className="drawing-tool-option"
                key={action.type}
                type="button"
                role="menuitem"
                onClick={() => chooseTool(action.type)}
              >
                <span aria-hidden="true">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
            <label className="drawing-route-profile">
              <span>Land route type</span>
              <select
                value={routeProfile}
                onChange={(event) => setRouteProfile(event.target.value)}
              >
                {ROUTE_PROFILES.map((profile) => (
                  <option key={profile.value} value={profile.value}>{profile.label}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <form className="address-search" role="search" onSubmit={submitSearch}>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search address or place"
          aria-label="Search address or place"
        />
        <button disabled={disabled || searching || searchQuery.trim().length < 3} type="submit" title="Search">
          {searching ? '…' : '⌕'}
        </button>
        {(searchResults.length > 0 || searchMessage) && (
          <div className="address-search-results">
            {searchMessage && <p>{searchMessage}</p>}
            {searchResults.map((result) => (
              <div className="address-search-result" key={result.id ?? result.label}>
                <button className="search-result-main" type="button" onClick={() => onPreviewSearchResult(result)}>
                  <strong>{result.name || result.label}</strong>
                  {result.name && <span>{result.label}</span>}
                </button>
                <div className="search-result-actions">
                  <button type="button" onClick={() => { onPreviewSearchResult(result); onAddSearchPoint(result); clearSearch(); }}>Add point</button>
                  <button type="button" onClick={() => { onUseSearchAsRouteStart(result, routeProfile); clearSearch(); }}>Route from here</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </form>

      <button
        className="tool-button locate-device-button"
        disabled={disabled || locating}
        type="button"
        onClick={locateDevice}
        title="Find this device and add its position to the active layer"
        aria-label="Find this device and add its position"
      >
        <span aria-hidden="true">{locating ? '…' : '◎'}</span>
        <span className="locate-device-label">{locating ? 'Locating' : 'My location'}</span>
      </button>

      {routingActive && (
        <button className="tool-button route-cancel-button" type="button" onClick={onCancelRouting} title="Cancel route tool">
          <span aria-hidden="true">×</span><span>Cancel route</span>
        </button>
      )}

      {routingStatus && <span className="routing-status" role="status">{routingStatus}</span>}

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
  basemapId,
  basemaps,
  projection,
  disabled,
  features,
  layers,
  legend,
  savedView,
  selectedFeatureId,
  selectedFeatureIds,
  viewMessage,
  onAddLayer,
  onApplyGeoJSON,
  onBasemapChange,
  onProjectionChange,
  onClearView,
  onDeleteLayer,
  onDuplicateFeature,
  onExport,
  onImport,
  onFitToFeatures,
  onLayerChange,
  onLegendChange,
  onLegendLayerChange,
  onRenameLayer,
  onPreviewView,
  onReorderLayer,
  onSaveView,
  onSelectFeature,
  onToggleLayer,
  tutorialExpanded,
  tutorialSection,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState('layers');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (tutorialExpanded !== undefined) setCollapsed(!tutorialExpanded);
    if (tutorialSection) setActiveSection(tutorialSection);
  }, [tutorialExpanded, tutorialSection]);

  async function handleFileChange(event) {
    const [file] = event.target.files;
    if (file) await onImport(file);
    event.target.value = '';
  }

  return (
    <aside className={`app-menu ${collapsed ? 'app-menu--collapsed' : ''}`}>
      <div className="panel-heading">
        <strong>{collapsed ? '' : 'Map editor'}</strong>
        <div className="panel-heading-actions">
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
              selectedFeatureIds={selectedFeatureIds}
              onAddLayer={onAddLayer}
              onDeleteLayer={onDeleteLayer}
              onDuplicateFeature={onDuplicateFeature}
              onLayerChange={onLayerChange}
              onReorderLayer={onReorderLayer}
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
              basemapId={basemapId}
              basemaps={basemaps}
              projection={projection}
              disabled={disabled}
              layers={layers}
              legend={legend}
              savedView={savedView}
              viewMessage={viewMessage}
              onBasemapChange={onBasemapChange}
              onProjectionChange={onProjectionChange}
              onClearView={onClearView}
              onFitToFeatures={onFitToFeatures}
              onLegendChange={onLegendChange}
              onLegendLayerChange={onLegendLayerChange}
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
        accept=".geojson,.json,.kml,.gpx,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/gpx+xml"
        onChange={onFileChange}
      />
      <div className="button-row">
        <button className="secondary-button" disabled={disabled} type="button" onClick={() => fileInputRef.current?.click()}>Import layer</button>
        <button className="secondary-button" disabled={disabled || features.length === 0} type="button" onClick={onExport}>Export</button>
      </div>
      <p className="data-drop-help">You can also drop a GeoJSON, KML, or GPX file directly onto the map.</p>

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
  basemapId,
  basemaps,
  projection,
  disabled,
  layers,
  legend,
  savedView,
  viewMessage,
  onBasemapChange,
  onProjectionChange,
  onClearView,
  onFitToFeatures,
  onLegendChange,
  onLegendLayerChange,
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
      <p className="section-label">Basemap</p>
      <label className="field-label" htmlFor="basemap-select">Map style</label>
      <select
        id="basemap-select"
        className="basemap-select"
        disabled={disabled}
        value={basemapId}
        onChange={(event) => onBasemapChange(event.target.value)}
      >
        {basemaps.map((basemap) => (
          <option key={basemap.id} value={basemap.id}>{basemap.name}</option>
        ))}
      </select>
      <p className="basemap-description">
        {basemaps.find((basemap) => basemap.id === basemapId)?.description}
      </p>

      <div className="basemap-preview-grid">
        {basemaps.map((basemap) => (
          <button
            className={`basemap-preview is-${basemap.id} ${basemap.id === basemapId ? 'is-selected' : ''}`}
            disabled={disabled}
            key={basemap.id}
            type="button"
            aria-label={`Use ${basemap.name} basemap`}
            onClick={() => onBasemapChange(basemap.id)}
          >
            <span />
            <strong>{basemap.name}</strong>
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="projection-select">Projection</label>
      <select
        id="projection-select"
        className="basemap-select"
        disabled={disabled}
        value={projection}
        onChange={(event) => onProjectionChange(event.target.value)}
      >
        <option value="mercator">Mercator</option>
        <option value="globe">Globe</option>
      </select>
      <p className="basemap-description">
        Weather temporarily uses Mercator and restores your selected projection when turned off.
      </p>

      <div className="map-settings-divider" />
      <div className="section-heading-row">
        <p className="section-label">Legend</p>
        <label className="legend-master-toggle">
          <input
            type="checkbox"
            checked={legend.visible}
            onChange={(event) => onLegendChange({ visible: event.target.checked })}
          />
          <span>Show</span>
        </label>
      </div>

      <label className="field-label" htmlFor="legend-title">Title</label>
      <input
        id="legend-title"
        disabled={!legend.visible}
        value={legend.title}
        placeholder="Legend"
        onChange={(event) => onLegendChange({ title: event.target.value })}
      />

      <label className="field-label" htmlFor="legend-position">Position</label>
      <select
        id="legend-position"
        disabled={!legend.visible}
        value={legend.position}
        onChange={(event) => onLegendChange({ position: event.target.value })}
      >
        <option value="top-left">Top left</option>
        <option value="top-right">Top right</option>
        <option value="bottom-left">Bottom left</option>
        <option value="bottom-right">Bottom right</option>
      </select>

      <fieldset className="legend-appearance-fieldset" disabled={!legend.visible}>
        <legend>Appearance</legend>
        <div className="legend-appearance-grid">
          <label>
            <span className="field-label">Background</span>
            <input
              className="legend-color-input"
              type="color"
              value={legend.backgroundColor}
              onChange={(event) => onLegendChange({ backgroundColor: event.target.value })}
            />
          </label>
          <label>
            <span className="field-label">Text color</span>
            <input
              className="legend-color-input"
              type="color"
              value={legend.textColor}
              onChange={(event) => onLegendChange({ textColor: event.target.value })}
            />
          </label>
          <label className="legend-font-field">
            <span className="field-label">Font</span>
            <select
              value={legend.fontFamily}
              onChange={(event) => onLegendChange({ fontFamily: event.target.value })}
            >
              <option value="sans">Sans serif</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
          </label>
        </div>

        <label className="legend-range-field">
          <span>Background opacity</span>
          <input
            type="range"
            min="20"
            max="100"
            step="1"
            value={legend.backgroundOpacity}
            onChange={(event) => onLegendChange({ backgroundOpacity: Number(event.target.value) })}
          />
          <output>{legend.backgroundOpacity}%</output>
        </label>

        <label className="legend-glow-toggle">
          <input
            type="checkbox"
            checked={legend.glowEnabled}
            onChange={(event) => onLegendChange({ glowEnabled: event.target.checked })}
          />
          <span>Box glow</span>
        </label>

        {legend.glowEnabled && (
          <div className="legend-glow-options">
            <label>
              <span className="field-label">Glow color</span>
              <input
                className="legend-color-input"
                type="color"
                value={legend.glowColor}
                onChange={(event) => onLegendChange({ glowColor: event.target.value })}
              />
            </label>
            <label className="legend-range-field">
              <span>Glow size</span>
              <input
                type="range"
                min="4"
                max="40"
                step="1"
                value={legend.glowSize}
                onChange={(event) => onLegendChange({ glowSize: Number(event.target.value) })}
              />
              <output>{legend.glowSize}px</output>
            </label>
          </div>
        )}
      </fieldset>

      <p className="field-label legend-items-heading">Layer entries</p>
      <div className="legend-editor-list">
        {layers.map((layer) => (
          <div className="legend-editor-row" key={layer.id}>
            <input
              type="checkbox"
              checked={layer.showInLegend !== false}
              disabled={!legend.visible}
              title={`Include ${layer.name} in legend`}
              aria-label={`Include ${layer.name} in legend`}
              onChange={(event) => onLegendLayerChange(layer.id, { showInLegend: event.target.checked })}
            />
            <input
              className="legend-color-input"
              type="color"
              value={layer.legendColor ?? '#1e90ff'}
              disabled={!legend.visible || layer.showInLegend === false}
              title={`Legend color for ${layer.name}`}
              aria-label={`Legend color for ${layer.name}`}
              onChange={(event) => onLegendLayerChange(layer.id, { legendColor: event.target.value })}
            />
            <input
              value={layer.legendLabel ?? layer.name}
              disabled={!legend.visible || layer.showInLegend === false}
              aria-label={`Legend label for ${layer.name}`}
              onChange={(event) => onLegendLayerChange(layer.id, { legendLabel: event.target.value })}
            />
          </div>
        ))}
      </div>
      <p className="legend-help">The symbol shape follows the geometry in each layer. Color and label can be adjusted for the published legend.</p>
    </div>
  );
}

function LayersSection({
  activeLayerId,
  features,
  layers,
  selectedFeatureId,
  selectedFeatureIds,
  onAddLayer,
  onDeleteLayer,
  onDuplicateFeature,
  onLayerChange,
  onReorderLayer,
  onRenameLayer,
  onSelectFeature,
  onToggleLayer,
}) {
  const selectionAnchorRef = useRef(null);
  const contextMenuRef = useRef(null);
  const [draggedLayerId, setDraggedLayerId] = useState(null);
  const [dropLayerId, setDropLayerId] = useState(null);
  const [featureMenu, setFeatureMenu] = useState(null);

  useEffect(() => {
    if (!featureMenu) return undefined;

    function closeFeatureMenu(event) {
      if (!contextMenuRef.current?.contains(event.target)) setFeatureMenu(null);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setFeatureMenu(null);
    }

    document.addEventListener('pointerdown', closeFeatureMenu);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeFeatureMenu);
    window.addEventListener('scroll', closeFeatureMenu, true);

    return () => {
      document.removeEventListener('pointerdown', closeFeatureMenu);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeFeatureMenu);
      window.removeEventListener('scroll', closeFeatureMenu, true);
    };
  }, [featureMenu]);

  function openFeatureMenu(event, feature) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 170;
    const menuHeight = 48;
    setFeatureMenu({
      featureId: feature.id,
      name: featureListName(feature, 0),
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
    });
  }

  function duplicateFromMenu() {
    if (featureMenu?.featureId !== undefined) {
      onDuplicateFeature(featureMenu.featureId);
    }
    setFeatureMenu(null);
  }

  function handleLayerDragStart(event, layerId) {
    setDraggedLayerId(layerId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', layerId);
  }

  function handleLayerDragOver(event, layerId) {
    if (!draggedLayerId || draggedLayerId === layerId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropLayerId(layerId);
  }

  function handleLayerDrop(event, targetLayerId) {
    event.preventDefault();
    event.stopPropagation();
    const sourceLayerId = draggedLayerId || event.dataTransfer.getData('text/plain');
    if (sourceLayerId && sourceLayerId !== targetLayerId) {
      onReorderLayer(sourceLayerId, targetLayerId);
    }
    setDraggedLayerId(null);
    setDropLayerId(null);
  }

  function handleLayerDragEnd() {
    setDraggedLayerId(null);
    setDropLayerId(null);
  }

  function handleFeatureClick(event, featureId, layerFeatures) {
    const ctrlPressed = event.ctrlKey || event.metaKey;

    if (event.shiftKey) {
      const anchorId = selectionAnchorRef.current ?? selectedFeatureId;
      const anchorIndex = layerFeatures.findIndex(
        (feature) => String(feature.id) === String(anchorId),
      );
      const clickedIndex = layerFeatures.findIndex(
        (feature) => String(feature.id) === String(featureId),
      );

      if (anchorIndex >= 0 && clickedIndex >= 0) {
        const first = Math.min(anchorIndex, clickedIndex);
        const last = Math.max(anchorIndex, clickedIndex);
        onSelectFeature(featureId, {
          additiveRange: ctrlPressed,
          rangeIds: layerFeatures.slice(first, last + 1).map((feature) => feature.id),
        });
        return;
      }
    }

    selectionAnchorRef.current = featureId;
    onSelectFeature(featureId, { additive: ctrlPressed || event.shiftKey });
  }

  return (
    <div className="menu-section layers-section">
      <style>{`
        .layer-drag-handle {
          display: grid;
          flex: 0 0 24px;
          width: 24px;
          height: 30px;
          padding: 0;
          place-items: center;
          border: 0;
          background: transparent;
          color: #78909c;
          font-size: 15px;
          line-height: 1;
          cursor: grab;
          user-select: none;
        }

        .layer-drag-handle:active { cursor: grabbing; }
        .layer-drag-handle:hover { color: #d8e6ec; }
        .layer-card.is-dragging { opacity: 0.48; }
        .layer-card.is-drop-target {
          outline: 2px solid #477fa5;
          outline-offset: 2px;
        }

        .feature-context-menu {
          position: fixed;
          z-index: 10060;
          width: 170px;
          padding: 5px;
          border: 1px solid #536b78;
          border-radius: 8px;
          background: #172229;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
        }

        .feature-context-menu button {
          width: 100%;
          padding: 8px 10px;
          border: 0;
          border-radius: 5px;
          background: transparent;
          color: #eef5f8;
          text-align: left;
          cursor: pointer;
        }

        .feature-context-menu button:hover,
        .feature-context-menu button:focus-visible {
          background: #28404d;
          outline: none;
        }
      `}</style>
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
          const selectedIds = new Set((selectedFeatureIds ?? []).map(String));
          const layerHasSelection = layerFeatures.some(
            (feature) => selectedIds.has(String(feature.id)),
          );

          return (
            <section
              className={[
                'layer-card',
                active ? 'is-active' : '',
                layerHasSelection ? 'has-selection' : '',
                draggedLayerId === layer.id ? 'is-dragging' : '',
                dropLayerId === layer.id ? 'is-drop-target' : '',
              ].filter(Boolean).join(' ')}
              key={layer.id}
              onDragOver={(event) => handleLayerDragOver(event, layer.id)}
              onDrop={(event) => handleLayerDrop(event, layer.id)}
            >
              <div className="layer-row">
                <button
                  className="layer-drag-handle"
                  draggable
                  type="button"
                  title={`Drag to reorder ${layer.name}`}
                  aria-label={`Drag to reorder ${layer.name}`}
                  onDragStart={(event) => handleLayerDragStart(event, layer.id)}
                  onDragEnd={handleLayerDragEnd}
                >
                  ⋮⋮
                </button>
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
              {(active || layerHasSelection) && (
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
                          className={[
                            selectedIds.has(String(feature.id)) ? 'is-selected' : '',
                            String(feature.id) === String(selectedFeatureId) ? 'is-primary' : '',
                          ].filter(Boolean).join(' ')}
                          key={feature.id}
                          type="button"
                          onClick={(event) => handleFeatureClick(event, feature.id, layerFeatures)}
                          onContextMenu={(event) => openFeatureMenu(event, feature)}
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

      {featureMenu && (
        <div
          ref={contextMenuRef}
          className="feature-context-menu"
          role="menu"
          aria-label={`Actions for ${featureMenu.name}`}
          style={{ left: featureMenu.x, top: featureMenu.y }}
        >
          <button type="button" role="menuitem" onClick={duplicateFromMenu}>
            Duplicate feature
          </button>
        </div>
      )}

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
