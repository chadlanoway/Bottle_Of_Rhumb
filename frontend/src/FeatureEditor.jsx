import { useEffect, useMemo, useState } from 'react';
import { getBasemapStyleDefaults } from './style-defaults.js';

const RESERVED_PROPERTIES = new Set([
  'name',
  'description',
  'layerId',
  'mode',
  'selected',
  'currentlyDrawing',
  'committedCoordinateCount',
  'provisionalCoordinateCount',
  'featureType',
  'featureColor',
  'featureOpacity',
  'featureSize',
  'featureDash',
  'featureFillColor',
  'featureFillOpacity',
  'featureBorderColor',
  'featureBorderOpacity',
  'featureBorderWidth',
  'featureGlowEnabled',
  'featureGlowColor',
  'featureGlowSize',
  'featureGlowOpacity',
  'labelEnabled',
  'labelText',
  'text',
  'textFont',
  'textColor',
  'textSize',
  'textBackground',
  'backgroundColor',
  'backgroundRounded',
  'backgroundShadow',
  'popupEnabled',
  'popupTitle',
  'popupDescription',
  'popupFields',
  'popupImageUrl',
  'popupImageKey',
  'popupImageAlt',
  'popupImageCaption',
  'popupYouTubeUrl',
  'popupBackgroundColor',
  'popupBackgroundOpacity',
  'popupTextColor',
  'popupFontFamily',
  'popupGlowEnabled',
  'popupGlowColor',
  'popupGlowSize',
  'popupBorderColor',
  'popupBorderOpacity',
  'popupBorderWidth',
  'popupBorderRadius',
  'popupMaxWidth',
]);

const FONT_OPTIONS = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
];

export default function FeatureEditor({ feature, features = [], basemapId, onDelete, onGeometryOperation, onImageUpload, onPreview, onUpdate, openRequest, tutorialExpanded, tutorialTab }) {
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState('details');
  const [rows, setRows] = useState([]);
  const selectionCount = features.length || (feature ? 1 : 0);
  const multiple = selectionCount > 1;
  const styleDefaults = getBasemapStyleDefaults(basemapId);

  const customProperties = useMemo(
    () => Object.entries(feature?.properties ?? {}).filter(
      ([key]) => !RESERVED_PROPERTIES.has(key),
    ),
    [feature],
  );

  useEffect(() => {
    const textFeature = feature?.properties?.featureType === 'text';
    setCollapsed(true);
    setActiveTab(multiple ? 'geometry' : textFeature ? 'text' : 'details');
    setRows(customProperties.map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value: formatValue(value),
      savedKey: key,
    })));
  }, [feature?.id, feature?.properties?.featureType, multiple, selectionCount]);

  useEffect(() => {
    if (tutorialExpanded !== undefined) setCollapsed(!tutorialExpanded);
    if (tutorialTab) setActiveTab(tutorialTab);
  }, [tutorialExpanded, tutorialTab]);

  useEffect(() => {
    if (!openRequest || String(openRequest.featureId) !== String(feature?.id)) return;
    setCollapsed(false);
    setActiveTab(openRequest.tab || 'details');
  }, [openRequest, feature?.id]);

  if (!feature) return null;

  const isTextFeature = feature.properties?.featureType === 'text';

  function updateRow(id, field, value) {
    setRows((current) => current.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
  }

  function saveRow(row) {
    const key = row.key.trim();
    const changes = {};

    if (row.savedKey && row.savedKey !== key) changes[row.savedKey] = undefined;
    if (key) changes[key] = parseValue(row.value);
    if (Object.keys(changes).length > 0) onUpdate(changes);

    setRows((current) => current.map((candidate) => (
      candidate.id === row.id ? { ...candidate, key, savedKey: key } : candidate
    )));
  }

  function removeRow(row) {
    if (row.savedKey) onUpdate({ [row.savedKey]: undefined });
    setRows((current) => current.filter((candidate) => candidate.id !== row.id));
  }

  if (collapsed) {
    return (
      <button
        className="feature-editor-toggle"
        type="button"
        title="Open feature editor. Hold Shift, Ctrl, or Cmd while clicking features to select several."
        aria-label="Open feature editor"
        onClick={() => setCollapsed(false)}
      >
        <span aria-hidden="true">☷</span>
        <span className="feature-editor-toggle-label">{multiple ? `${selectionCount} features` : 'Feature'}</span>
      </button>
    );
  }

  return (
    <section className="feature-editor" aria-label="Feature editor">
      <header className="feature-editor-heading">
        <div>
          <span className="feature-editor-eyebrow">{multiple ? 'Multiple selection' : 'Selected feature'}</span>
          <strong>{multiple ? `${selectionCount} selected features` : feature.properties?.name || feature.geometry?.type}</strong>
        </div>
        <button className="editor-collapse-button" type="button" aria-label="Collapse feature editor" onClick={() => setCollapsed(true)}>⌄</button>
      </header>

      <div className="multi-select-help" title="Hold Shift, Ctrl, or Cmd and click map or layer-list features to add them. Click normally to begin a new selection.">
        <span aria-hidden="true">ⓘ</span>
        <span>Hold <kbd>Shift</kbd> or <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> and click features to select several.</span>
      </div>

      <nav className={`feature-editor-tabs ${multiple ? 'is-multi' : ''}`} aria-label="Feature editor sections">
        {(multiple ? ['geometry'] : ['details', 'text', 'popup', 'properties', 'geometry']).map((tab) => (
          <button className={activeTab === tab ? 'is-active' : ''} key={tab} type="button" onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      <div className="feature-editor-body">
        {!multiple && activeTab === 'details' && (
          <>
            <label className="field-label" htmlFor="feature-editor-name">Name</label>
            <input
              id="feature-editor-name"
              value={feature.properties?.name ?? ''}
              placeholder={`${feature.geometry?.type} name`}
              onChange={(event) => onUpdate({ name: event.target.value })}
            />
            <label className="field-label" htmlFor="feature-editor-description">Description</label>
            <textarea
              id="feature-editor-description"
              rows="3"
              value={feature.properties?.description ?? ''}
              placeholder="What should viewers know about this feature?"
              onChange={(event) => onUpdate({ description: event.target.value })}
            />
            {!isTextFeature && (
              <AppearanceControls defaults={styleDefaults.feature} feature={feature} onUpdate={onUpdate} />
            )}
          </>
        )}

        {!multiple && activeTab === 'properties' && (
          <>
            <div className="property-column-labels"><span>Key</span><span>Value</span><span /></div>
            <div className="property-list">
              {rows.map((row) => (
                <div className="property-row" key={row.id}>
                  <input
                    aria-label="Property key"
                    value={row.key}
                    placeholder="key"
                    onBlur={() => saveRow(row)}
                    onChange={(event) => updateRow(row.id, 'key', event.target.value)}
                  />
                  <input
                    aria-label="Property value"
                    value={row.value}
                    placeholder="value"
                    onBlur={() => saveRow(row)}
                    onChange={(event) => updateRow(row.id, 'value', event.target.value)}
                  />
                  <button type="button" title="Remove property" aria-label="Remove property" onClick={() => removeRow(row)}>×</button>
                </div>
              ))}
            </div>
            <button
              className="add-property-button"
              type="button"
              onClick={() => setRows((current) => [
                ...current,
                { id: crypto.randomUUID(), key: '', value: '', savedKey: '' },
              ])}
            >
              + Add property
            </button>
          </>
        )}

        {!multiple && activeTab === 'text' && (
          <TextControls defaults={styleDefaults.text} feature={feature} isTextFeature={isTextFeature} onUpdate={onUpdate} />
        )}

        {!multiple && activeTab === 'popup' && (
          <PopupControls
            feature={feature}
            defaults={styleDefaults.popup}
            onCollapse={() => setCollapsed(true)}
            onImageUpload={onImageUpload}
            onPreview={onPreview}
            onUpdate={onUpdate}
          />
        )}

        {activeTab === 'geometry' && (
          <GeometryControls feature={feature} selectionCount={selectionCount} onRun={onGeometryOperation} />
        )}
      </div>

      <footer className="feature-editor-footer">
        <span>{multiple ? `${selectionCount} selected` : isTextFeature ? 'Text' : feature.geometry?.type}</span>
        <button className="delete-feature-button" type="button" onClick={onDelete}>
          {multiple ? `Delete ${selectionCount} features` : 'Delete feature'}
        </button>
      </footer>
    </section>
  );
}

function AppearanceControls({ defaults, feature, onUpdate }) {
  const properties = feature.properties ?? {};
  const geometryType = feature.geometry?.type;
  const isPoint = geometryType === 'Point' || geometryType === 'MultiPoint';
  const isLine = geometryType === 'LineString' || geometryType === 'MultiLineString';
  const supportsDash = geometryType === 'LineString'
    || geometryType === 'MultiLineString'
    || geometryType === 'Polygon'
    || geometryType === 'MultiPolygon';
  const size = Number(properties.featureSize ?? (isPoint ? defaults.pointSize : defaults.lineWidth));
  const opacity = Number(properties.featureOpacity ?? defaults.opacity);
  const isPolygon = geometryType === 'Polygon' || geometryType === 'MultiPolygon';
  const supportsBorder = isPoint || isLine || isPolygon;
  const borderColor = properties.featureBorderColor ?? defaults.borderColor;
  const borderOpacity = Number(properties.featureBorderOpacity ?? defaults.borderOpacity);
  const defaultBorderWidth = isPoint
    ? defaults.pointBorderWidth
    : isLine ? defaults.lineBorderWidth : defaults.polygonBorderWidth;
  const borderWidth = Number(properties.featureBorderWidth ?? defaultBorderWidth);
  const fillColor = properties.featureFillColor ?? properties.featureColor ?? defaults.fillColor;
  const fillOpacity = Number(properties.featureFillOpacity ?? defaults.fillOpacity);
  const glowEnabled = properties.featureGlowEnabled ?? defaults.glowEnabled;
  const glowColor = properties.featureGlowColor ?? properties.featureColor ?? defaults.glowColor;
  const glowSize = Number(properties.featureGlowSize ?? defaults.glowSize);
  const glowOpacity = Number(properties.featureGlowOpacity ?? defaults.glowOpacity);

  return (
    <fieldset className="feature-appearance-fieldset">
      <legend>Appearance</legend>
      <div className="feature-appearance-grid">
        <label>
          <span className="field-label">Color</span>
          <input
            className="feature-color-input"
            type="color"
            value={properties.featureColor ?? defaults.color}
            onChange={(event) => onUpdate({ featureColor: event.target.value })}
          />
        </label>

        {supportsDash && (
          <label>
            <span className="field-label">Line style</span>
            <select
              value={properties.featureDash ?? defaults.dash}
              onChange={(event) => onUpdate({ featureDash: event.target.value })}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
        )}
      </div>

      <label className="feature-appearance-range">
        <span>{isPoint ? 'Point size' : 'Line width'}</span>
        <div>
          <input
            type="range"
            min={isPoint ? 3 : 1}
            max={isPoint ? 20 : 12}
            step="1"
            value={size}
            onChange={(event) => onUpdate({ featureSize: Number(event.target.value) })}
          />
          <output>{size}px</output>
        </div>
      </label>

      {isPolygon && (
        <div className="feature-subsection">
          <strong>Polygon fill</strong>
          <div className="feature-appearance-grid">
            <label>
              <span className="field-label">Fill color</span>
              <input className="feature-color-input" type="color" value={fillColor}
                onChange={(event) => onUpdate({ featureFillColor: event.target.value })} />
            </label>
          </div>
          <label className="feature-appearance-range">
            <span>Fill opacity</span>
            <div><input type="range" min="0" max="100" step="1" value={fillOpacity}
              onChange={(event) => onUpdate({ featureFillOpacity: Number(event.target.value) })} />
              <output>{fillOpacity}%</output></div>
          </label>
        </div>
      )}

      {supportsBorder && (
        <div className="feature-subsection">
          <strong>Border</strong>
          <div className="feature-appearance-grid">
            <label>
              <span className="field-label">Border color</span>
              <input className="feature-color-input" type="color" value={borderColor}
                onChange={(event) => onUpdate({ featureBorderColor: event.target.value })} />
            </label>
          </div>
          <label className="feature-appearance-range"><span>Border width</span><div>
            <input type="range" min="0" max="12" step="1" value={borderWidth}
              onChange={(event) => onUpdate({ featureBorderWidth: Number(event.target.value) })} />
            <output>{borderWidth}px</output></div></label>
          <label className="feature-appearance-range"><span>Border opacity</span><div>
            <input type="range" min="0" max="100" step="1" value={borderOpacity}
              onChange={(event) => onUpdate({ featureBorderOpacity: Number(event.target.value) })} />
            <output>{borderOpacity}%</output></div></label>
        </div>
      )}

      <div className="feature-subsection">
        <label className="legend-glow-toggle">
          <input type="checkbox" checked={glowEnabled}
            onChange={(event) => onUpdate({ featureGlowEnabled: event.target.checked })} />
          <span>Feature glow</span>
        </label>
        {glowEnabled && <>
          <div className="feature-appearance-grid"><label>
            <span className="field-label">Glow color</span>
            <input className="feature-color-input" type="color" value={glowColor}
              onChange={(event) => onUpdate({ featureGlowColor: event.target.value })} />
          </label></div>
          <label className="feature-appearance-range"><span>Glow size</span><div>
            <input type="range" min="2" max="30" step="1" value={glowSize}
              onChange={(event) => onUpdate({ featureGlowSize: Number(event.target.value) })} />
            <output>{glowSize}px</output></div></label>
          <label className="feature-appearance-range"><span>Glow opacity</span><div>
            <input type="range" min="5" max="100" step="1" value={glowOpacity}
              onChange={(event) => onUpdate({ featureGlowOpacity: Number(event.target.value) })} />
            <output>{glowOpacity}%</output></div></label>
        </>}
      </div>

      <label className="feature-appearance-range">
        <span>Opacity</span>
        <div>
          <input
            type="range"
            min="5"
            max="100"
            step="1"
            value={opacity}
            onChange={(event) => onUpdate({ featureOpacity: Number(event.target.value) })}
          />
          <output>{opacity}%</output>
        </div>
      </label>

      <button
        className="reset-feature-appearance"
        type="button"
        onClick={() => onUpdate({
          featureColor: undefined,
          featureOpacity: undefined,
          featureSize: undefined,
          featureDash: undefined,
          featureFillColor: undefined,
          featureFillOpacity: undefined,
          featureBorderColor: undefined,
          featureBorderOpacity: undefined,
          featureBorderWidth: undefined,
          featureGlowEnabled: undefined,
          featureGlowColor: undefined,
          featureGlowSize: undefined,
          featureGlowOpacity: undefined,
        })}
      >
        Reset appearance
      </button>
    </fieldset>
  );
}

function GeometryControls({ feature, selectionCount, onRun }) {
  const [tolerance, setTolerance] = useState(0.001);
  const [status, setStatus] = useState('');
  const type = feature.geometry?.type;
  const canSimplify = type === 'LineString' || type === 'Polygon';
  const hasSeveralCoordinates = type !== 'Point';
  const multiple = selectionCount > 1;

  async function run(operation, options) {
    const response = await onRun(operation, options);
    setStatus(response?.message ?? '');
  }

  return (
    <div className="geometry-controls">
      <p className="geometry-help">
        Results are added as new features in the most recently selected feature’s layer. Originals stay unchanged.
      </p>
      <div className="geometry-operation-grid">
        <button type="button" disabled={multiple} onClick={() => run('centroid')}>Create centroid<span>One selected feature</span></button>
        <button type="button" disabled={!multiple && !hasSeveralCoordinates} onClick={() => run('extent')}>Add extent box<span>Around all selected features</span></button>
        <button type="button" onClick={() => run('hull')}>Add convex hull<span>Around the outermost coordinates</span></button>
        <button type="button" disabled={!multiple && type === 'Point'} onClick={() => run('points')}>Convert to points<span>Vertices from all selections</span></button>
      </div>

      <div className="simplify-controls">
        <div>
          <strong>Simplify geometry</strong>
          <span>Reduce vertices while keeping the overall shape.</span>
        </div>
        <label htmlFor="simplify-tolerance">
          Tolerance (degrees)
          <input
            id="simplify-tolerance"
            type="number"
            min="0.000001"
            max="1"
            step="0.0001"
            value={tolerance}
            disabled={multiple || !canSimplify}
            onChange={(event) => setTolerance(event.target.value)}
          />
        </label>
        <button type="button" disabled={multiple || !canSimplify} onClick={() => run('simplify', { tolerance })}>
          Add simplified copy
        </button>
      </div>
      {status && <p className="geometry-status" role="status">{status}</p>}
    </div>
  );
}

function PopupControls({ defaults, feature, onCollapse, onImageUpload, onPreview, onUpdate }) {
  const properties = feature.properties ?? {};
  const enabled = properties.popupEnabled === true;
  const backgroundColor = properties.popupBackgroundColor ?? defaults.backgroundColor;
  const backgroundOpacity = properties.popupBackgroundOpacity ?? defaults.backgroundOpacity;
  const textColor = properties.popupTextColor ?? defaults.textColor;
  const fontFamily = properties.popupFontFamily ?? defaults.fontFamily;
  const glowEnabled = properties.popupGlowEnabled ?? defaults.glowEnabled;
  const glowColor = properties.popupGlowColor ?? defaults.glowColor;
  const glowSize = properties.popupGlowSize ?? defaults.glowSize;
  const borderColor = properties.popupBorderColor ?? defaults.borderColor;
  const borderOpacity = properties.popupBorderOpacity ?? defaults.borderOpacity;
  const borderWidth = properties.popupBorderWidth ?? defaults.borderWidth;
  const borderRadius = properties.popupBorderRadius ?? defaults.borderRadius;
  const maxWidth = properties.popupMaxWidth ?? defaults.maxWidth;
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const selectedFields = Array.isArray(properties.popupFields) ? properties.popupFields : [];
  const availableFields = Object.keys(properties).filter(
    (key) => !RESERVED_PROPERTIES.has(key),
  );

  function toggleField(key, checked) {
    const next = checked
      ? [...new Set([...selectedFields, key])]
      : selectedFields.filter((field) => field !== key);
    onUpdate({ popupFields: next });
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    setUploadMessage('');
    const result = await onImageUpload(file);
    setUploading(false);
    setUploadMessage(result?.ok ? 'Image uploaded.' : result?.error || 'Image upload failed.');
  }

  function removeImage() {
    onUpdate({
      popupImageUrl: undefined,
      popupImageKey: undefined,
      popupImageAlt: undefined,
      popupImageCaption: undefined,
    });
    setUploadMessage('Image removed from this popup.');
  }

  function resetAppearance() {
    onUpdate({
      popupBackgroundColor: undefined,
      popupBackgroundOpacity: undefined,
      popupTextColor: undefined,
      popupFontFamily: undefined,
      popupGlowEnabled: undefined,
      popupGlowColor: undefined,
      popupGlowSize: undefined,
      popupBorderColor: undefined,
      popupBorderOpacity: undefined,
      popupBorderWidth: undefined,
      popupBorderRadius: undefined,
      popupMaxWidth: undefined,
    });
  }

  return (
    <div className="popup-controls">
      <label className="toggle-field">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onUpdate({ popupEnabled: event.target.checked })}
        />
        <span>Show a popup when viewers click this feature</span>
      </label>

      {enabled && (
        <>
          <label className="field-label" htmlFor="popup-title">Popup title</label>
          <input
            id="popup-title"
            value={properties.popupTitle ?? properties.name ?? ''}
            placeholder="Popup title"
            onChange={(event) => onUpdate({ popupTitle: event.target.value })}
          />

          <label className="field-label" htmlFor="popup-description">Description</label>
          <textarea
            id="popup-description"
            rows="3"
            value={properties.popupDescription ?? properties.description ?? ''}
            placeholder="What should the popup tell viewers?"
            onChange={(event) => onUpdate({ popupDescription: event.target.value })}
          />

          <div className="popup-image-controls">
            <div className="popup-image-heading">
              <div>
                <strong>Popup image</strong>
                <span>JPEG, PNG, or WebP up to 8 MB.</span>
              </div>
              <label className={`popup-image-upload-button ${uploading ? 'is-disabled' : ''}`}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={uploadImage}
                />
                {uploading ? 'Uploading…' : properties.popupImageUrl ? 'Replace image' : 'Add image'}
              </label>
            </div>

            {properties.popupImageUrl && (
              <div className="popup-image-preview">
                <img src={properties.popupImageUrl} alt={properties.popupImageAlt || 'Popup image preview'} />
                <button type="button" onClick={removeImage}>Remove image</button>
              </div>
            )}

            {properties.popupImageUrl && (
              <div className="popup-image-fields">
                <label>
                  <span className="field-label">Alternative text</span>
                  <input
                    value={properties.popupImageAlt ?? ''}
                    placeholder="Describe the image for accessibility"
                    onChange={(event) => onUpdate({ popupImageAlt: event.target.value })}
                  />
                </label>
                <label>
                  <span className="field-label">Caption</span>
                  <input
                    value={properties.popupImageCaption ?? ''}
                    placeholder="Optional image caption"
                    onChange={(event) => onUpdate({ popupImageCaption: event.target.value })}
                  />
                </label>
              </div>
            )}

            {uploadMessage && <p className="popup-image-message" role="status">{uploadMessage}</p>}
          </div>

          <div className="popup-youtube-controls">
            <label className="field-label" htmlFor="popup-youtube-url">YouTube video</label>
            <input
              id="popup-youtube-url"
              type="url"
              value={properties.popupYouTubeUrl ?? ''}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(event) => onUpdate({ popupYouTubeUrl: event.target.value })}
            />
            <small>
              Paste a YouTube, YouTube Shorts, or youtu.be link. Autoplay is disabled.
            </small>
            {properties.popupYouTubeUrl && !isYouTubeUrl(properties.popupYouTubeUrl) && (
              <p className="popup-youtube-error" role="status">Enter a valid YouTube video URL.</p>
            )}
          </div>

          <fieldset className="popup-appearance-fieldset">
            <legend>Appearance</legend>
            

            <div className="popup-appearance-grid">
              <label>
                <span className="field-label">Background</span>
                <input
                  className="legend-color-input"
                  type="color"
                  value={backgroundColor}
                  onChange={(event) => onUpdate({ popupBackgroundColor: event.target.value })}
                />
              </label>
              <label>
                <span className="field-label">Text color</span>
                <input
                  className="legend-color-input"
                  type="color"
                  value={textColor}
                  onChange={(event) => onUpdate({ popupTextColor: event.target.value })}
                />
              </label>
              <label>
                <span className="field-label">Font</span>
                <select
                  value={fontFamily}
                  onChange={(event) => onUpdate({ popupFontFamily: event.target.value })}
                >
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
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
                value={backgroundOpacity}
                onChange={(event) => onUpdate({ popupBackgroundOpacity: Number(event.target.value) })}
              />
              <output>{backgroundOpacity}%</output>
            </label>

            <div className="popup-style-section">
              <strong>Border and shape</strong>
              <div className="popup-appearance-grid">
                <label><span className="field-label">Border color</span>
                  <input className="legend-color-input" type="color" value={borderColor}
                    onChange={(event) => onUpdate({ popupBorderColor: event.target.value })} />
                </label>
              </div>
              <label className="legend-range-field"><span>Border width</span>
                <input type="range" min="0" max="10" step="1" value={borderWidth}
                  onChange={(event) => onUpdate({ popupBorderWidth: Number(event.target.value) })} />
                <output>{borderWidth}px</output>
              </label>
              <label className="legend-range-field"><span>Border opacity</span>
                <input type="range" min="0" max="100" step="1" value={borderOpacity}
                  onChange={(event) => onUpdate({ popupBorderOpacity: Number(event.target.value) })} />
                <output>{borderOpacity}%</output>
              </label>
              <label className="legend-range-field"><span>Corner radius</span>
                <input type="range" min="0" max="30" step="1" value={borderRadius}
                  onChange={(event) => onUpdate({ popupBorderRadius: Number(event.target.value) })} />
                <output>{borderRadius}px</output>
              </label>
              <label className="legend-range-field"><span>Popup width</span>
                <input type="range" min="220" max="600" step="10" value={maxWidth}
                  onChange={(event) => onUpdate({ popupMaxWidth: Number(event.target.value) })} />
                <output>{maxWidth}px</output>
              </label>
            </div>

            <label className="legend-glow-toggle">
              <input
                type="checkbox"
                checked={glowEnabled}
                onChange={(event) => onUpdate({ popupGlowEnabled: event.target.checked })}
              />
              <span>Box glow</span>
            </label>

            {glowEnabled && (
              <div className="popup-glow-options">
                <label>
                  <span className="field-label">Glow color</span>
                  <input
                    className="legend-color-input"
                    type="color"
                    value={glowColor}
                    onChange={(event) => onUpdate({ popupGlowColor: event.target.value })}
                  />
                </label>
                <label className="legend-range-field">
                  <span>Glow size</span>
                  <input
                    type="range"
                    min="4"
                    max="40"
                    step="1"
                    value={glowSize}
                    onChange={(event) => onUpdate({ popupGlowSize: Number(event.target.value) })}
                  />
                  <output>{glowSize}px</output>
                </label>
              </div>
            )}
            <button className="reset-feature-appearance" type="button" onClick={resetAppearance}>
              Reset popup appearance
            </button>
          </fieldset>

          <p className="field-label popup-fields-heading">Properties to display</p>
          {availableFields.length === 0 ? (
            <p className="text-help">Add key/value properties first if you want them in the popup.</p>
          ) : (
            <div className="popup-field-list">
              {availableFields.map((key) => (
                <label className="popup-field-option" key={key}>
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(key)}
                    onChange={(event) => toggleField(key, event.target.checked)}
                  />
                  <span>{key}</span>
                </label>
              ))}
            </div>
          )}

          <button
            className="preview-popup-button"
            type="button"
            onClick={() => {
              onPreview();
                onCollapse();
            }}
          >
            Preview popup
          </button>
        </>
      )}
    </div>
  );
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{6,20}$/.test(url.pathname.split('/').filter(Boolean)[0] || '');
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return false;
    const id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1];
    return /^[A-Za-z0-9_-]{6,20}$/.test(id || '');
  } catch {
    return false;
  }
}

function TextControls({ defaults, feature, isTextFeature, onUpdate }) {
  const properties = feature.properties ?? {};
  const enabled = isTextFeature || properties.labelEnabled === true;

  return (
    <div className="text-controls">
      {!isTextFeature && (
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onUpdate({ labelEnabled: event.target.checked })}
          />
          <span>Show a label on this feature</span>
        </label>
      )}

      {enabled && (
        <>
          <label className="field-label" htmlFor="feature-text-content">Text</label>
          <input
            id="feature-text-content"
            value={isTextFeature ? properties.text ?? '' : properties.labelText ?? properties.name ?? ''}
            placeholder={isTextFeature ? 'Type map text' : 'Feature label'}
            onChange={(event) => onUpdate({
              [isTextFeature ? 'text' : 'labelText']: event.target.value,
            })}
          />

          <div className="text-style-grid">
            <label>
              <span className="field-label">Font</span>
              <select
                value={properties.textFont ?? defaults.fontFamily}
                onChange={(event) => onUpdate({ textFont: event.target.value })}
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Color</span>
              <input
                className="color-input"
                type="color"
                value={properties.textColor ?? defaults.color}
                onChange={(event) => onUpdate({ textColor: event.target.value })}
              />
            </label>
            <label>
              <span className="field-label">Size</span>
              <div className="size-control">
                <input
                  type="range"
                  min="10"
                  max="40"
                  step="1"
                  value={properties.textSize ?? defaults.size}
                  onChange={(event) => onUpdate({ textSize: Number(event.target.value) })}
                />
                <output>{properties.textSize ?? defaults.size}px</output>
              </div>
            </label>
          </div>
          <div className="text-background-controls">
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={properties.textBackground === true}
                onChange={(event) => onUpdate({ textBackground: event.target.checked })}
              />
              <span>Show text background</span>
            </label>

            {properties.textBackground === true && (
              <div className="background-options">
                <label>
                  <span className="field-label">Background color</span>
                  <input
                    className="color-input"
                    type="color"
                    value={properties.backgroundColor ?? defaults.backgroundColor}
                    onChange={(event) => onUpdate({ backgroundColor: event.target.value })}
                  />
                </label>
                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={properties.backgroundRounded ?? defaults.backgroundRounded}
                    onChange={(event) => onUpdate({ backgroundRounded: event.target.checked })}
                  />
                  <span>Rounded corners</span>
                </label>
                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={properties.backgroundShadow ?? defaults.backgroundShadow}
                    onChange={(event) => onUpdate({ backgroundShadow: event.target.checked })}
                  />
                  <span>Box shadow</span>
                </label>
              </div>
            )}
          </div>
          {isTextFeature && <p className="text-help">Use Select to move this text point later.</p>}
        </>
      )}
    </div>
  );
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parseValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
