import { useEffect, useMemo, useState } from 'react';

const STEP_NAMES = ['Map columns', 'Validate', 'Visualize'];

export default function CsvImportWizard({ fileName, inspection, signedIn, status, onCancel, onImport }) {
  const [step, setStep] = useState(0);
  const [mapping, setMapping] = useState({ ...inspection.suggestions });
  const [layerName, setLayerName] = useState(fileName.replace(/\.csv$/i, '') || 'Imported CSV');
  const [visualizationType, setVisualizationType] = useState('symbols');
  const [weightField, setWeightField] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completeMessage, setCompleteMessage] = useState('');

  const validation = useMemo(
    () => analyzeMapping(inspection.rows, mapping),
    [inspection.rows, mapping],
  );
  const excludedFields = new Set([
    mapping.latitudeField,
    mapping.longitudeField,
    mapping.nameField,
    mapping.fullAddressField,
    mapping.streetField,
    mapping.cityField,
    mapping.stateField,
    mapping.postalField,
    mapping.countryField,
  ].filter(Boolean));
  const weightFields = inspection.numericFields.filter((field) => !excludedFields.has(field));

  useEffect(() => {
    if (weightField && !weightFields.includes(weightField)) setWeightField('');
  }, [weightField, weightFields]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);

  const mappingValid = mapping.mode === 'coordinates'
    ? Boolean(mapping.latitudeField && mapping.longitudeField)
    : mapping.addressMode === 'full'
      ? Boolean(mapping.fullAddressField)
      : Boolean([
        mapping.streetField,
        mapping.cityField,
        mapping.stateField,
        mapping.postalField,
        mapping.countryField,
      ].some(Boolean));
  const validationValid = validation.validRows > 0
    && (mapping.mode !== 'address' || (signedIn && validation.validRows <= 1000));

  async function finishImport() {
    setBusy(true);
    setError('');
    const result = await onImport({
      mapping,
      layerName: layerName.trim() || 'Imported CSV',
      visualization: {
        type: visualizationType,
        weightField: visualizationType === 'heatmap' ? weightField : '',
      },
    });
    if (result?.ok) {
      setCompleteMessage(result.message || status || 'CSV import complete.');
      setBusy(false);
    } else {
      setError(result?.error || 'The CSV could not be imported.');
      setBusy(false);
    }
  }

  return (
    <div className="csv-wizard-backdrop" role="presentation">
      <section className="csv-wizard" role="dialog" aria-modal="true" aria-labelledby="csv-wizard-title">
        <header className="csv-wizard-header">
          <div>
            <span className="csv-wizard-kicker">CSV import</span>
            <h2 id="csv-wizard-title">{fileName}</h2>
          </div>
          <button type="button" aria-label="Close CSV import" disabled={busy} onClick={onCancel}>×</button>
        </header>

        <ol className="csv-wizard-steps" aria-label="CSV import steps">
          {STEP_NAMES.map((name, index) => (
            <li key={name} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''}>
              <span>{index + 1}</span>{name}
            </li>
          ))}
        </ol>

        <div className="csv-wizard-content">
          {step === 0 && (
            <>
              <div className="csv-wizard-section-heading">
                <div><h3>Tell us how this file locates places</h3><p>We made an initial guess. Change any field that is incorrect.</p></div>
                <span>{inspection.totalRows.toLocaleString()} rows</span>
              </div>

              <div className="csv-mode-options">
                <label className={mapping.mode === 'coordinates' ? 'is-selected' : ''}>
                  <input type="radio" name="csv-mode" checked={mapping.mode === 'coordinates'} onChange={() => update('mode', 'coordinates')} />
                  <span><strong>Coordinates</strong><small>Use latitude and longitude fields</small></span>
                </label>
                <label className={mapping.mode === 'address' ? 'is-selected' : ''}>
                  <input type="radio" name="csv-mode" checked={mapping.mode === 'address'} onChange={() => update('mode', 'address')} />
                  <span><strong>Street addresses</strong><small>Geocode through Geoapify</small></span>
                </label>
              </div>

              <div className="csv-field-grid">
                {mapping.mode === 'coordinates' ? (
                  <>
                    <ColumnSelect label="Latitude" value={mapping.latitudeField} required fields={inspection.fields} onChange={(value) => update('latitudeField', value)} />
                    <ColumnSelect label="Longitude" value={mapping.longitudeField} required fields={inspection.fields} onChange={(value) => update('longitudeField', value)} />
                  </>
                ) : (
                  <>
                    <label className="csv-field csv-field--wide">
                      <span>Address format</span>
                      <select value={mapping.addressMode} onChange={(event) => update('addressMode', event.target.value)}>
                        <option value="full">One complete address field</option>
                        <option value="components">Separate address fields</option>
                      </select>
                    </label>
                    {mapping.addressMode === 'full' ? (
                      <ColumnSelect className="csv-field--wide" label="Complete address" value={mapping.fullAddressField} required fields={inspection.fields} onChange={(value) => update('fullAddressField', value)} />
                    ) : (
                      <>
                        <ColumnSelect label="Street" value={mapping.streetField} fields={inspection.fields} onChange={(value) => update('streetField', value)} />
                        <ColumnSelect label="City" value={mapping.cityField} fields={inspection.fields} onChange={(value) => update('cityField', value)} />
                        <ColumnSelect label="State / region" value={mapping.stateField} fields={inspection.fields} onChange={(value) => update('stateField', value)} />
                        <ColumnSelect label="ZIP / postal code" value={mapping.postalField} fields={inspection.fields} onChange={(value) => update('postalField', value)} />
                        <ColumnSelect label="Country" value={mapping.countryField} fields={inspection.fields} onChange={(value) => update('countryField', value)} />
                      </>
                    )}
                  </>
                )}
                <ColumnSelect label="Feature name (optional)" value={mapping.nameField} fields={inspection.fields} onChange={(value) => update('nameField', value)} />
              </div>

              <CsvPreview fields={inspection.fields} rows={inspection.previewRows} />
            </>
          )}

          {step === 1 && (
            <>
              <div className="csv-wizard-section-heading">
                <div><h3>Review the import</h3><p>Invalid rows will be skipped and reported on the new layer.</p></div>
              </div>
              <div className="csv-validation-cards">
                <ValidationCard label="Total rows" value={inspection.totalRows} />
                <ValidationCard label={mapping.mode === 'address' ? 'Addresses to geocode' : 'Valid coordinates'} value={validation.validRows} tone="good" />
                <ValidationCard label="Empty or invalid" value={validation.invalidRows} tone={validation.invalidRows ? 'warning' : ''} />
              </div>
              {mapping.mode === 'address' && (
                <div className={`csv-geocode-notice ${signedIn ? '' : 'is-warning'}`}>
                  <strong>{signedIn ? 'Geoapify batch geocoding' : 'Sign-in required'}</strong>
                  <p>{signedIn
                    ? `${validation.validRows.toLocaleString()} address${validation.validRows === 1 ? '' : 'es'} will be sent through the protected geocoding endpoint.`
                    : 'Address-only CSV imports use your protected Geoapify quota. Close this wizard, sign in, and import the file again.'}</p>
                  {validation.validRows > 1000 && <p>A single Geoapify batch is limited to 1,000 addresses.</p>}
                </div>
              )}
              {mapping.mode === 'address' && validation.samples.length > 0 && (
                <div className="csv-address-samples">
                  <strong>Assembled address examples</strong>
                  {validation.samples.map((address) => <code key={address}>{address}</code>)}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="csv-wizard-section-heading">
                <div><h3>Choose the initial map display</h3><p>You can change these settings later in the Layers tab.</p></div>
              </div>
              <label className="csv-field csv-field--wide">
                <span>Layer name</span>
                <input value={layerName} maxLength="80" onChange={(event) => setLayerName(event.target.value)} />
              </label>
              <div className="csv-visualization-options">
                {[
                  ['symbols', 'Symbols', 'Editable individual points'],
                  ['clusters', 'Clusters', 'Group nearby points'],
                  ['heatmap', 'Heatmap', 'Show density or weighted intensity'],
                ].map(([value, label, description]) => (
                  <label key={value} className={visualizationType === value ? 'is-selected' : ''}>
                    <input type="radio" name="csv-visualization" checked={visualizationType === value} onChange={() => setVisualizationType(value)} />
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </label>
                ))}
              </div>
              {visualizationType === 'heatmap' && (
                <label className="csv-field csv-field--wide csv-weight-field">
                  <span>Heatmap weight</span>
                  <select value={weightField} onChange={(event) => setWeightField(event.target.value)}>
                    <option value="">Weight every point equally</option>
                    {weightFields.map((field) => <option key={field} value={field}>{field}</option>)}
                  </select>
                  <small>{weightFields.length
                    ? 'Numeric data fields are available as weights.'
                    : 'No additional numeric fields were detected, so every point will have equal weight.'}</small>
                </label>
              )}
              <div className="csv-import-summary-card">
                <strong>Ready to add {validation.validRows.toLocaleString()} point{validation.validRows === 1 ? '' : 's'}</strong>
                <span>{visualizationType === 'heatmap' && weightField
                  ? `Heatmap weighted by “${weightField}”.`
                  : `${visualizationType[0].toUpperCase()}${visualizationType.slice(1)} with equal feature weighting.`}</span>
              </div>
            </>
          )}

          {error && <p className="csv-wizard-error" role="alert">{error}</p>}
          {(busy || completeMessage) && (
            <div className={`csv-wizard-progress ${completeMessage ? 'is-complete' : ''}`} role="status" aria-live="polite">
              <span className="csv-wizard-progress-icon" aria-hidden="true">{completeMessage ? '✓' : '⌖'}</span>
              <div>
                <strong>{completeMessage ? 'Import complete' : 'Processing CSV'}</strong>
                <span>{completeMessage || status || 'Preparing the import…'}</span>
              </div>
            </div>
          )}
        </div>

        <footer className="csv-wizard-footer">
          {completeMessage ? <span /> : (
            <button type="button" className="secondary-button" disabled={busy} onClick={step === 0 ? onCancel : () => setStep((value) => value - 1)}>
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
          )}
          {completeMessage ? (
            <button type="button" className="primary-button" onClick={onCancel}>Done</button>
          ) : step < 2 ? (
            <button type="button" className="primary-button" disabled={busy || (step === 0 ? !mappingValid : !validationValid)} onClick={() => setStep((value) => value + 1)}>Next</button>
          ) : (
            <button type="button" className="primary-button" disabled={busy || !validationValid} onClick={finishImport}>{busy ? 'Importing…' : 'Import layer'}</button>
          )}
        </footer>
      </section>
    </div>
  );

  function update(key, value) {
    setMapping((current) => ({ ...current, [key]: value }));
  }
}

function ColumnSelect({ label, value, fields, onChange, required = false, className = '' }) {
  return (
    <label className={`csv-field ${className}`}>
      <span>{label}{required ? ' *' : ''}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{required ? 'Choose a column' : 'None'}</option>
        {fields.map((field) => <option key={field} value={field}>{field}</option>)}
      </select>
    </label>
  );
}

function CsvPreview({ fields, rows }) {
  return (
    <div className="csv-preview-wrap">
      <div className="csv-preview-heading"><strong>Data preview</strong><span>First {rows.length} rows</span></div>
      <div className="csv-preview-scroll">
        <table className="csv-preview-table">
          <thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={index}>{fields.map((field) => <td key={field}>{String(row[field] ?? '') || '—'}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function ValidationCard({ label, value, tone = '' }) {
  return <div className={`csv-validation-card ${tone ? `is-${tone}` : ''}`}><strong>{Number(value).toLocaleString()}</strong><span>{label}</span></div>;
}

function analyzeMapping(rows, mapping) {
  let validRows = 0;
  const samples = [];
  for (const row of rows) {
    if (mapping.mode === 'coordinates') {
      const latitude = numeric(row[mapping.latitudeField]);
      const longitude = numeric(row[mapping.longitudeField]);
      if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) validRows += 1;
    } else {
      const fields = mapping.addressMode === 'full'
        ? [mapping.fullAddressField]
        : [mapping.streetField, mapping.cityField, mapping.stateField, mapping.postalField, mapping.countryField];
      const address = fields.filter(Boolean).map((field) => String(row[field] ?? '').trim()).filter(Boolean).join(', ');
      if (address) {
        validRows += 1;
        if (samples.length < 3) samples.push(address);
      }
    }
  }
  return { validRows, invalidRows: rows.length - validRows, samples };
}

function numeric(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  return text ? Number(text) : Number.NaN;
}
