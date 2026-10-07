const WEATHER_BASE_URL = trimSlash(import.meta.env.VITE_WEATHER_BASE_URL ?? '');
const WEATHER_GEOJSON_URL = trimSlash(
  import.meta.env.VITE_WEATHER_GEOJSON_URL
    ?? `${import.meta.env.BASE_URL}weather/data/geojson`,
);

export class RhumbMapControl {
  constructor() {
    this.map = null;
    this.container = null;
    this.weather = null;
    this.weatherPromise = null;
    this.mode = null;
    this.buttons = new Map();
    this.featureOverlay = null;
  }

  onAdd(map) {
    this.map = map;
    this.featureOverlay = new WeatherFeatureOverlay(map);
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group rhumb-map-controls';

    this.addButton('zoom-in', '+', 'Zoom in', () => map.zoomIn());
    this.addButton('zoom-out', '−', 'Zoom out', () => map.zoomOut());
    this.addButton('compass', '◇', 'Reset bearing and pitch', () => {
      map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    });
    this.addButton('wind', '💨', 'Show wind', () => this.toggleWeather('wind'));
    this.addButton('waves', '🌊', 'Show waves', () => this.toggleWeather('waves'));

    if (!WEATHER_BASE_URL) {
      this.setWeatherUnavailable('Add VITE_WEATHER_BASE_URL to enable weather');
    }

    return this.container;
  }

  onRemove() {
    this.weather?.destroy?.();
    this.featureOverlay?.destroy();
    this.container?.remove();
    this.map = null;
    this.container = null;
  }

  addButton(id, content, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `rhumb-control-button rhumb-control-${id}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = content;
    button.addEventListener('click', onClick);
    this.container.appendChild(button);
    this.buttons.set(id, button);
  }

  async toggleWeather(nextMode) {
    const button = this.buttons.get(nextMode);
    if (!WEATHER_BASE_URL || button?.disabled) return;

    const mode = this.mode === nextMode ? null : nextMode;
    this.setBusy(true);

    try {
      const weather = await this.getWeather();
      await weather.setMode(mode);
      this.mode = mode;
      this.featureOverlay?.setVisible(Boolean(mode));
      this.featureOverlay?.bringToFront();
      this.updateWeatherButtons();
    } catch (error) {
      console.error('Weather overlay failed:', error);
      this.setWeatherUnavailable(error.message || 'Weather failed to load');
    } finally {
      this.setBusy(false);
    }
  }

  async getWeather() {
    if (this.weather) return this.weather;
    if (this.weatherPromise) return this.weatherPromise;

    this.weatherPromise = createWeather(this.map)
      .then((weather) => {
        this.weather = weather;
        this.featureOverlay?.bringToFront();
        return weather;
      })
      .catch((error) => {
        this.weatherPromise = null;
        throw error;
      });

    return this.weatherPromise;
  }

  setFeatures(features, hiddenLayerIds = [], selectedFeatureId = null) {
    this.featureOverlay?.setData(features, hiddenLayerIds, selectedFeatureId);
  }

  async disableWeather() {
    if (!this.mode || !this.weather) return;
    await this.weather.setMode(null);
    this.mode = null;
    this.featureOverlay?.setVisible(false);
    this.updateWeatherButtons();
  }

  updateWeatherButtons() {
    for (const id of ['wind', 'waves']) {
      const active = this.mode === id;
      const button = this.buttons.get(id);
      button?.classList.toggle('is-active', active);
      button?.setAttribute('aria-pressed', String(active));
      if (button) button.title = active ? `Hide ${id}` : `Show ${id}`;
    }
  }

  setBusy(isBusy) {
    for (const id of ['wind', 'waves']) {
      const button = this.buttons.get(id);
      if (button) button.classList.toggle('is-loading', isBusy);
    }
  }

  setWeatherUnavailable(message) {
    for (const id of ['wind', 'waves']) {
      const button = this.buttons.get(id);
      if (!button) continue;
      button.disabled = true;
      button.title = message;
      button.classList.add('is-unavailable');
    }
  }
}

async function createWeather(map) {
  if (!globalThis.WeatherOverlay?.mount) {
    throw new Error('weather-overlay.js did not load');
  }

  const [windMeta, waveMeta, pressureMeta] = await Promise.all([
    getLatest(`${WEATHER_BASE_URL}/wind/latest/latest.json`),
    getLatest(`${WEATHER_BASE_URL}/waves/latest/latest.json`),
    getLatest(`${WEATHER_BASE_URL}/pressure/latest/latest.json`),
  ]);

  const isobarsPath = pressureMeta.data?.latest?.isobars
    ?? pressureMeta.data?.isobars;

  if (!isobarsPath) throw new Error('Pressure metadata is missing its isobars path');

  const weather = globalThis.WeatherOverlay.mount(map, {
    windSpeedUrl: addVersion(`${WEATHER_BASE_URL}/wind/latest/speed.tif`, windMeta.version),
    windUvUrl: addVersion(`${WEATHER_BASE_URL}/wind/latest/uv.tif`, windMeta.version),
    waveHeightUrl: addVersion(`${WEATHER_BASE_URL}/waves/latest/height.tif`, waveMeta.version),
    waveUvUrl: addVersion(`${WEATHER_BASE_URL}/waves/latest/uv.tif`, waveMeta.version),
    isobarsUrl: addVersion(toAbsoluteWeatherUrl(isobarsPath), pressureMeta.version),
    geojsonBase: WEATHER_GEOJSON_URL,
    boats: [],
  });

  return weather;
}

class WeatherFeatureOverlay {
  constructor(map) {
    this.map = map;
    this.features = [];
    this.hiddenLayerIds = new Set();
    this.selectedFeatureId = null;
    this.visible = false;
    this.frame = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'weather-feature-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(this.canvas);
    this.redraw = () => this.scheduleDraw();
    for (const event of ['move', 'zoom', 'rotate', 'pitch', 'resize']) {
      map.on(event, this.redraw);
    }
    this.draw();
  }

  setData(features, hiddenLayerIds, selectedFeatureId) {
    this.features = Array.isArray(features) ? features : [];
    this.hiddenLayerIds = new Set(hiddenLayerIds);
    this.selectedFeatureId = selectedFeatureId;
    this.scheduleDraw();
  }

  setVisible(visible) {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
    this.scheduleDraw();
  }

  bringToFront() {
    this.canvas.parentElement?.appendChild(this.canvas);
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  draw() {
    const width = this.map.getCanvas().clientWidth;
    const height = this.map.getCanvas().clientHeight;
    const pixelRatio = globalThis.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * pixelRatio)
      || this.canvas.height !== Math.round(height * pixelRatio)) {
      this.canvas.width = Math.round(width * pixelRatio);
      this.canvas.height = Math.round(height * pixelRatio);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }

    const context = this.canvas.getContext('2d');
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!this.visible) return;

    for (const feature of this.features) {
      if (this.hiddenLayerIds.has(feature.properties?.layerId)) continue;
      this.drawFeature(context, feature);
    }
  }

  drawFeature(context, feature) {
    const geometry = feature.geometry;
    if (!geometry) return;
    const selected = String(feature.id) === String(this.selectedFeatureId);
    const properties = feature.properties ?? {};
    const type = geometry.type;

    context.save();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = selected ? '#ffcf5a' : properties.stroke ?? properties.color ?? '#1e90ff';
    context.fillStyle = colorWithAlpha(properties.fill ?? properties.fillColor ?? '#1e90ff', selected ? 0.38 : 0.24);
    context.lineWidth = selected ? 5 : Number(properties.strokeWidth ?? properties.lineWidth ?? 3);
    context.shadowColor = 'rgba(0,0,0,.6)';
    context.shadowBlur = 3;

    if (type === 'Point') {
      this.drawPoint(context, geometry.coordinates, properties, selected);
    } else if (type === 'MultiPoint') {
      for (const point of geometry.coordinates) this.drawPoint(context, point, properties, selected);
    } else if (type === 'LineString') {
      this.drawLine(context, geometry.coordinates);
    } else if (type === 'MultiLineString') {
      for (const line of geometry.coordinates) this.drawLine(context, line);
    } else if (type === 'Polygon') {
      this.drawPolygon(context, geometry.coordinates);
    } else if (type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) this.drawPolygon(context, polygon);
    }

    context.restore();
  }

  drawPoint(context, coordinates, properties, selected) {
    const point = this.map.project(coordinates);
    if (properties.featureType === 'text') {
      this.drawText(context, point, properties.text || 'Text', properties);
      return;
    }

    context.beginPath();
    context.arc(point.x, point.y, selected ? 8 : 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (properties.labelEnabled) {
      this.drawText(context, { x: point.x, y: point.y - 12 }, properties.labelText || properties.name || '', properties);
    }
  }

  drawLine(context, coordinates) {
    if (coordinates.length < 2) return;
    context.beginPath();
    coordinates.forEach((coordinate, index) => {
      const point = this.map.project(coordinate);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  }

  drawPolygon(context, rings) {
    context.beginPath();
    for (const ring of rings) {
      ring.forEach((coordinate, index) => {
        const point = this.map.project(coordinate);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.closePath();
    }
    context.fill('evenodd');
    context.stroke();
  }

  drawText(context, point, text, properties) {
    if (!text) return;
    const size = Number(properties.textSize ?? 16);
    context.font = `600 ${size}px ${fontFamily(properties.textFont)}`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(255,255,255,.9)';
    context.fillStyle = properties.textColor ?? '#172229';
    context.strokeText(text, point.x, point.y);
    context.fillText(text, point.x, point.y);
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    for (const event of ['move', 'zoom', 'rotate', 'pitch', 'resize']) {
      this.map.off(event, this.redraw);
    }
    this.canvas.remove();
  }
}

function colorWithAlpha(color, alpha) {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  }
  return color;
}

function fontFamily(value) {
  const fonts = {
    sans: 'Arial, sans-serif',
    serif: 'Georgia, serif',
    condensed: "'Barlow Condensed', sans-serif",
    mono: "Consolas, 'Courier New', monospace",
  };
  return fonts[value] ?? fonts.sans;
}

async function getLatest(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Weather metadata request failed (${response.status})`);

  const data = await response.json();
  const version = data.version
    ?? data.updatedAt
    ?? data.generatedAt
    ?? data.latest?.version
    ?? Date.now();

  return { data, version: String(version) };
}

function addVersion(url, version) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function toAbsoluteWeatherUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${WEATHER_BASE_URL}/${String(path).replace(/^\/+/, '')}`;
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}
