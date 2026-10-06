import { useEffect, useMemo, useState } from 'react';

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
]);

const FONT_OPTIONS = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
];

export default function FeatureEditor({ feature, onDelete, onPreview, onUpdate }) {
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState('details');
  const [rows, setRows] = useState([]);

  const customProperties = useMemo(
    () => Object.entries(feature?.properties ?? {}).filter(
      ([key]) => !RESERVED_PROPERTIES.has(key),
    ),
    [feature],
  );

  useEffect(() => {
    const textFeature = feature?.properties?.featureType === 'text';
    setCollapsed(!textFeature);
    setActiveTab(textFeature ? 'text' : 'details');
    setRows(customProperties.map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value: formatValue(value),
      savedKey: key,
    })));
  }, [feature?.id, feature?.properties?.featureType]);

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
        title="Open feature editor"
        aria-label="Open feature editor"
        onClick={() => setCollapsed(false)}
      >
        <span aria-hidden="true">☷</span>
        <span className="feature-editor-toggle-label">Feature</span>
      </button>
    );
  }

  return (
    <section className="feature-editor" aria-label="Feature editor">
      <header className="feature-editor-heading">
        <div>
          <span className="feature-editor-eyebrow">Selected feature</span>
          <strong>{feature.properties?.name || feature.geometry?.type}</strong>
        </div>
        <button className="editor-collapse-button" type="button" aria-label="Collapse feature editor" onClick={() => setCollapsed(true)}>⌄</button>
      </header>

      <nav className="feature-editor-tabs" aria-label="Feature editor sections">
        {['details', 'text', 'popup', 'properties'].map((tab) => (
          <button className={activeTab === tab ? 'is-active' : ''} key={tab} type="button" onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      <div className="feature-editor-body">
        {activeTab === 'details' && (
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
          </>
        )}

        {activeTab === 'properties' && (
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

        {activeTab === 'text' && (
          <TextControls feature={feature} isTextFeature={isTextFeature} onUpdate={onUpdate} />
        )}

        {activeTab === 'popup' && (
          <PopupControls feature={feature} onPreview={onPreview} onUpdate={onUpdate} />
        )}
      </div>

      <footer className="feature-editor-footer">
        <span>{isTextFeature ? 'Text' : feature.geometry?.type}</span>
        <button className="delete-feature-button" type="button" onClick={onDelete}>Delete feature</button>
      </footer>
    </section>
  );
}

function PopupControls({ feature, onPreview, onUpdate }) {
  const properties = feature.properties ?? {};
  const enabled = properties.popupEnabled === true;
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

          <button className="preview-popup-button" type="button" onClick={onPreview}>
            Preview popup
          </button>
        </>
      )}
    </div>
  );
}

function TextControls({ feature, isTextFeature, onUpdate }) {
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
                value={properties.textFont ?? 'sans'}
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
                value={properties.textColor ?? '#172229'}
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
                  value={properties.textSize ?? 16}
                  onChange={(event) => onUpdate({ textSize: Number(event.target.value) })}
                />
                <output>{properties.textSize ?? 16}px</output>
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
                    value={properties.backgroundColor ?? '#ffffff'}
                    onChange={(event) => onUpdate({ backgroundColor: event.target.value })}
                  />
                </label>
                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={properties.backgroundRounded !== false}
                    onChange={(event) => onUpdate({ backgroundRounded: event.target.checked })}
                  />
                  <span>Rounded corners</span>
                </label>
                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={properties.backgroundShadow !== false}
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
