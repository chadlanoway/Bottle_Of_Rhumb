import { useEffect, useRef, useState } from 'react';
import Menu, { AppHeader, EditorToolbar } from './Menu.jsx';
import FeatureEditor from './FeatureEditor.jsx';
import Tutorial from './Tutorial.jsx';
import DrawingContextMenu from './DrawingContextMenu.jsx';
import {
  BASEMAPS,
  createMap,
  fitMapToFeatures,
  getMapView,
  previewMapView,
} from './map.js';
import {
  addDerivedGeoJSON,
  createQuickRouteController,
  addGeoJSON,
  deleteFeatures,
  deleteLayerFeatures,
  exportGeoJSON,
  previewFeaturePopup,
  removeFeatureAppearanceLayers,
  replaceGeoJSON,
  restoreGeoJSON,
  selectFeature,
  setHiddenLayers,
  setMultiSelectedFeatures,
  setupDrawingTools,
  setupViewerFeatureInteractions,
  startDrawing,
  updateFeature,
} from './drawing-tools.js';
import { runGeometryOperation } from './geometry-operations.js';
import {
  createLandRoutingController,
  searchAddresses,
  searchResultPoint,
  requestWaterRoute,
} from './routing-tools.js';
import {
  isSupportedPopupImage,
  readImageGps,
  uploadPopupImage,
} from './image-upload.js';
import {
  isSupportedSpatialFile,
  readSpatialFile,
  spatialFileLayerName,
} from './file-import.js';
import { geocodeCsvAddresses } from './csv-geocoding.js';
import { initializeAuth, signIn, signOut } from './auth.js';
import {
  createMap as createSavedMap,
  deleteMap as deleteSavedMap,
  listMaps as listSavedMaps,
  loadMap as loadSavedMap,
  updateMap as updateSavedMap,
} from './map-storage.js';
import { DEFAULT_STYLE, getBasemapStyleDefaults } from './style-defaults.js';
import {
  DEFAULT_LAYER_VISUALIZATION,
  drawingHiddenLayerIds,
  removeLayerVisualizations,
  syncLayerVisualizations,
} from './layer-visualization.js';

const LEGEND_COLORS = ['#1e90ff', '#e06c5b', '#45a36f', '#9b72cf', '#d49a36', '#2ba6a6'];

function makeLayer(id, name, index = 0) {
  return {
    id,
    name,
    visible: true,
    showInLegend: true,
    legendLabel: name,
    legendColor: LEGEND_COLORS[index % LEGEND_COLORS.length],
    visualization: { ...DEFAULT_LAYER_VISUALIZATION },
  };
}

const DEFAULT_LAYER = makeLayer('default-layer', 'Untitled layer');
const LAND_ROUTING_API_URL = import.meta.env.VITE_LAND_ROUTING_API_URL ?? '';
const WATER_ROUTING_API_URL = import.meta.env.VITE_WATER_ROUTING_API_URL ?? '';
const IMAGE_UPLOAD_API_URL = import.meta.env.VITE_IMAGE_UPLOAD_API_URL ?? '';
const TUTORIAL_LAYER_ID = 'bottle-of-rhumb-tutorial';
const TUTORIAL_CENTER = [-87.72, 43.27];

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const activeLayerIdRef = useRef(DEFAULT_LAYER.id);
  const dragDepthRef = useRef(0);
  const routingControllerRef = useRef(null);
  const quickRouteControllerRef = useRef(null);
  const waterRouteControllerRef = useRef(null);
  const waterRouteAbortRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const tutorialFeatureIdsRef = useRef({ points: [], route: [] });
  const photoPlacementCleanupRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [features, setFeatures] = useState([]);
  const [layers, setLayers] = useState([DEFAULT_LAYER]);
  const [activeLayerId, setActiveLayerId] = useState(DEFAULT_LAYER.id);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState([]);
  const [savedView, setSavedView] = useState(null);
  const [viewMessage, setViewMessage] = useState('');
  const [error, setError] = useState('');
  const [dataImportStatus, setDataImportStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [basemapId, setBasemapId] = useState('positron');
  const [projection, setProjection] = useState('globe');
  const [routingActive, setRoutingActive] = useState(false);
  const [routingStatus, setRoutingStatus] = useState('');
  const [quickRouteActive, setQuickRouteActive] = useState(false);
  const [quickRouteStatus, setQuickRouteStatus] = useState('');
  const [waterRouteActive, setWaterRouteActive] = useState(false);
  const [waterRouteStatus, setWaterRouteStatus] = useState('');
  const [waterRouteLoading, setWaterRouteLoading] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(null);
  const [featureEditorRequest, setFeatureEditorRequest] = useState(null);
  const [drawingContextMenu, setDrawingContextMenu] = useState(null);
  const [authSession, setAuthSession] = useState(null);
  const [mapId, setMapId] = useState(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [ownsMap, setOwnsMap] = useState(false);
  const [mapTitle, setMapTitle] = useState('Untitled map');
  const [mapDescription, setMapDescription] = useState('');
  const [mapVisibility, setMapVisibility] = useState('draft');
  const [saveStatus, setSaveStatus] = useState('');
  const [myMaps, setMyMaps] = useState([]);
  const [myMapsStatus, setMyMapsStatus] = useState('');
  const [legend, setLegend] = useState({
    visible: true,
    title: 'Legend',
    position: 'bottom-right',
    ...DEFAULT_STYLE.legend,
  });
  const [mapControls, setMapControls] = useState({ ...DEFAULT_STYLE.controls });
  const legendRef = useRef(legend);
  legendRef.current = legend;

  activeLayerIdRef.current = activeLayerId;
  const selectedFeatureId = selectedFeatureIds.at(-1) ?? null;
  const query = new URLSearchParams(window.location.search);
  const viewerMode = Boolean(query.get('map'))
    && (query.get('view') === '1' || query.get('embed') === '1');
  const embedMode = query.get('embed') === '1';

  useEffect(() => {
    const hiddenLayerIds = drawingHiddenLayerIds(layers);
    setHiddenLayers(drawRef.current, mapRef.current, hiddenLayerIds);
    syncLayerVisualizations(mapRef.current, layers, features, layers[0]?.id);
    mapRef.current?.rhumbWeatherControl?.setFeatures(
      features,
      hiddenLayerIds,
      selectedFeatureId,
    );
    setMultiSelectedFeatures(mapRef.current, features, selectedFeatureIds);
  }, [features, layers, selectedFeatureId, selectedFeatureIds]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    container.style.setProperty(
      '--reference-popup-background',
      hexToRgba(legend.backgroundColor, legend.backgroundOpacity / 100),
    );
    container.style.setProperty('--reference-popup-text', legend.textColor);
    container.style.setProperty('--reference-popup-font', legendFontFamily(legend.fontFamily));
    container.style.setProperty(
      '--reference-popup-shadow',
      legend.glowEnabled
        ? `0 0 ${legend.glowSize}px ${legend.glowColor}, 0 5px 18px rgba(0,0,0,.2)`
        : '0 5px 18px rgba(0,0,0,.2)',
    );
  }, [legend]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    container.style.setProperty(
      '--rhumb-control-background',
      hexToRgba(mapControls.backgroundColor, mapControls.backgroundOpacity / 100),
    );
    container.style.setProperty('--rhumb-control-color', mapControls.iconColor);
    container.style.setProperty('--rhumb-control-accent', mapControls.accentColor);
    container.style.setProperty('--rhumb-control-active-text', mapControls.activeTextColor);
    container.style.setProperty(
      '--rhumb-control-border',
      hexToRgba(mapControls.borderColor, mapControls.borderOpacity / 100),
    );
    container.style.setProperty('--rhumb-control-border-width', `${mapControls.borderWidth}px`);
    container.style.setProperty('--rhumb-control-radius', `${mapControls.borderRadius}px`);
    container.style.setProperty(
      '--rhumb-control-shadow',
      mapControls.glowEnabled
        ? `0 0 ${mapControls.glowSize}px ${mapControls.glowColor}, 0 7px 22px rgba(0,0,0,.36)`
        : '0 7px 22px rgba(0,0,0,.36)',
    );
    container.style.setProperty(
      '--rhumb-control-hover',
      hexToRgba(mapControls.accentColor, 0.28),
    );
  }, [mapControls]);

  useEffect(() => {
    let cancelled = false;
    const accessToken = authSession?.accessToken;
    if (!accessToken) {
      setMyMaps([]);
      setMyMapsStatus('');
      return undefined;
    }

    setMyMapsStatus('Loading maps…');
    listSavedMaps(accessToken)
      .then((maps) => {
        if (cancelled) return;
        setMyMaps(maps);
        setMyMapsStatus(maps.length === 0 ? 'No saved maps yet.' : '');
      })
      .catch((caughtError) => {
        if (!cancelled) setMyMapsStatus(caughtError.message || 'Maps could not be loaded.');
      });

    return () => { cancelled = true; };
  }, [authSession?.accessToken]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      let session = null;
      try {
        session = await initializeAuth();
        if (cancelled) return;
        setAuthSession(session);
      } catch (caughtError) {
        if (!cancelled) setError(caughtError.message);
      }

      const requestedMapId = new URLSearchParams(window.location.search).get('map');
      if (!requestedMapId) {
        if (!cancelled) mountMap(basemapId, [], [DEFAULT_LAYER], null);
        return;
      }

      try {
        const loaded = await loadSavedMap(requestedMapId, session?.accessToken);
        if (cancelled) return;
        const document = loaded.map;
        const restoredLayers = document.layers?.length
          ? document.layers
          : [DEFAULT_LAYER];
        const restoredFeatures = document.featureCollection?.features ?? [];
        const restoredActiveLayerId = restoredLayers.some(
          (layer) => layer.id === document.activeLayerId,
        )
          ? document.activeLayerId
          : restoredLayers[0].id;

        activeLayerIdRef.current = restoredActiveLayerId;
        setActiveLayerId(restoredActiveLayerId);
        setLayers(restoredLayers);
        setFeatures(restoredFeatures);
        setBasemapId(document.basemapId || 'positron');
        setProjection(document.projection === 'globe' ? 'globe' : 'mercator');
        setSavedView(document.view || null);
        const loadedStyleDefaults = getBasemapStyleDefaults(document.basemapId || 'positron');
        setLegend((current) => ({
          ...current,
          ...loadedStyleDefaults.legend,
          ...(document.legend ?? {}),
        }));
        setMapControls({
          ...loadedStyleDefaults.controls,
          ...(document.mapControls ?? {}),
        });
        setMapId(document.mapId);
        setMapRevision(document.revision || 0);
        setOwnsMap(loaded.editable);
        setMapTitle(document.title || 'Untitled map');
        setMapDescription(document.description || '');
        setMapVisibility(document.visibility || 'draft');

        mountMap(
          document.basemapId || 'positron',
          restoredFeatures,
          restoredLayers,
          null,
          document.view || null,
          document.projection || 'mercator',
        );
      } catch (caughtError) {
        if (cancelled) return;
        setError(caughtError.message);
        mountMap(basemapId, [], [DEFAULT_LAYER], null);
      }
    }

    initialize();

    return () => {
      cancelled = true;
      routingControllerRef.current?.destroy();
      quickRouteControllerRef.current?.destroy();
      waterRouteControllerRef.current?.destroy();
      waterRouteAbortRef.current?.abort();
      photoPlacementCleanupRef.current?.();
      searchMarkerRef.current?.remove();

      if (mapRef.current) {
        removeFeatureAppearanceLayers(mapRef.current);
        removeLayerVisualizations(mapRef.current);
        mapRef.current.remove();
      }
    };
  }, []);

  function mountMap(
    nextBasemapId,
    restoredFeatures,
    restoredLayers,
    restoredSelection,
    restoredView = null,
    restoredProjection = projection,
  ) {
    const map = createMap(mapContainerRef.current, nextBasemapId, {
      onAddReferencePoint: handleAddReferencePoint,
      projection: restoredProjection,
    });
    mapRef.current = map;

    map.on('load', () => {
      const draw = setupDrawingTools(
        map,
        (collection) => setFeatures(collection.features),
        () => activeLayerIdRef.current,
        handleSelectionChange,
        nextBasemapId,
      );
      drawRef.current = draw;
      if (viewerMode) {
        setupViewerFeatureInteractions(
          draw,
          map,
          () => getBasemapStyleDefaults(nextBasemapId).popup,
        );
      }
      routingControllerRef.current = createLandRoutingController(map, {
        apiUrl: LAND_ROUTING_API_URL,
        onActiveChange: setRoutingActive,
        onError: (caughtError) => setError(caughtError.message),
        onRoute: handleRouteReady,
        onStatus: setRoutingStatus,
      });
      quickRouteControllerRef.current = createQuickRouteController(map, {
        onActiveChange: setQuickRouteActive,
        onComplete: handleQuickRouteReady,
        onStatus: setQuickRouteStatus,
      });
      waterRouteControllerRef.current = createQuickRouteController(map, {
        onActiveChange: setWaterRouteActive,
        onComplete: handleWaterRouteReady,
        onStatus: setWaterRouteStatus,
      });

      if (restoredFeatures.length > 0) {
        restoreGeoJSON(
          draw,
          { type: 'FeatureCollection', features: restoredFeatures },
          activeLayerIdRef.current,
        );
      }

      const hiddenLayerIds = drawingHiddenLayerIds(restoredLayers);
      setHiddenLayers(draw, map, hiddenLayerIds);
      syncLayerVisualizations(map, restoredLayers, restoredFeatures, restoredLayers[0]?.id);

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
      if (restoredView) previewMapView(map, restoredView);
      setMapReady(true);
    });

    map.on('error', (event) => {
      if (event.error) setError(event.error.message);
    });
  }

  function handleDraw(type) {
    setError('');
    photoPlacementCleanupRef.current?.();
    setSelectedFeatureIds([]);
    routingControllerRef.current?.cancel();
    quickRouteControllerRef.current?.cancel();
    waterRouteControllerRef.current?.cancel();
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    startDrawing(drawRef.current, type);
  }

  function handleMapContextMenu(event) {
    if (viewerMode || !mapContainerRef.current?.contains(event.target)) return;
    event.preventDefault();
    setDrawingContextMenu({ x: event.clientX, y: event.clientY });
  }

  function handleContextTool(type) {
    setDrawingContextMenu(null);
    if (type === 'quick-route') handleStartQuickRoute();
    else if (type === 'water-route') handleStartWaterRoute();
    else if (type === 'land-route') handleStartRouting('foot-walking');
    else handleDraw(type);
  }

  function handleStartRouting(profile, presetStart = null) {
    setError('');
    photoPlacementCleanupRef.current?.();
    setSelectedFeatureIds([]);
    quickRouteControllerRef.current?.cancel();
    waterRouteControllerRef.current?.cancel();
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    startDrawing(drawRef.current, 'select');
    routingControllerRef.current?.arm(profile, presetStart);
  }

  function handleStartQuickRoute() {
    setError('');
    photoPlacementCleanupRef.current?.();
    setSelectedFeatureIds([]);
    routingControllerRef.current?.cancel();
    waterRouteControllerRef.current?.cancel();
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    startDrawing(drawRef.current, 'select');
    quickRouteControllerRef.current?.arm();
  }

  function handleStartWaterRoute() {
    setError('');
    photoPlacementCleanupRef.current?.();
    setSelectedFeatureIds([]);
    routingControllerRef.current?.cancel();
    quickRouteControllerRef.current?.cancel();
    mapRef.current?.rhumbWeatherControl?.disableWeather();
    startDrawing(drawRef.current, 'select');
    waterRouteControllerRef.current?.arm();
  }

  function handleQuickRouteReady(start, end) {
    try {
      const collection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Route start', routeRole: 'start', source: 'quick-route' },
            geometry: { type: 'Point', coordinates: start },
          },
          {
            type: 'Feature',
            properties: { name: 'Route destination', routeRole: 'destination', source: 'quick-route' },
            geometry: { type: 'Point', coordinates: end },
          },
          {
            type: 'Feature',
            properties: { name: 'Quick route', routeRole: 'route', source: 'quick-route' },
            geometry: { type: 'LineString', coordinates: [start, end] },
          },
        ],
      };
      const added = addDerivedGeoJSON(drawRef.current, collection, activeLayerIdRef.current);
      setFeatures(added.collection.features);
      const routeId = added.addedIds.at(-1);
      if (routeId !== undefined) {
        startDrawing(drawRef.current, 'select');
        selectFeature(drawRef.current, routeId);
        setSelectedFeatureIds([routeId]);
      }
      setQuickRouteStatus('Route selected. Drag vertices or midpoint handles to adjust it.');
      window.setTimeout(() => setQuickRouteStatus(''), 6000);
    } catch (caughtError) {
      setError(caughtError.message || 'The quick route could not be created.');
    }
  }

  async function handleWaterRouteReady(start, end) {
    const abortController = new AbortController();
    waterRouteAbortRef.current?.abort();
    waterRouteAbortRef.current = abortController;
    setWaterRouteLoading(true);
    setWaterRouteStatus('Calculating water route… New routes may take several seconds.');
    try {
      const payload = await requestWaterRoute(
        WATER_ROUTING_API_URL,
        start,
        end,
        'Water autoroute',
        abortController.signal,
      );
      const supported = [];
      for (const feature of payload.features) {
        const isRoute = feature.properties?.featureType === 'water-route';
        if (isRoute && feature.geometry?.type === 'MultiLineString') {
          feature.geometry.coordinates.forEach((coordinates, index) => {
            supported.push({
              ...feature,
              id: undefined,
              properties: {
                ...feature.properties,
                name: index === 0
                  ? feature.properties?.name || 'Water autoroute'
                  : `${feature.properties?.name || 'Water autoroute'} ${index + 1}`,
                waterRouteSegment: index + 1,
              },
              geometry: { type: 'LineString', coordinates },
            });
          });
        } else {
          supported.push({ ...feature, id: undefined });
        }
      }

      const collection = {
        type: 'FeatureCollection',
        features: supported.map((feature) => {
          const featureType = feature.properties?.featureType;
          const isRoute = featureType === 'water-route';
          return {
            ...feature,
            properties: {
              ...feature.properties,
              name: feature.properties?.name || (isRoute ? 'Water autoroute' : 'Route point'),
              routeRole: isRoute
                ? 'route'
                : featureType === 'route-start' ? 'start' : 'destination',
              routeDistanceKilometers: isRoute
                ? feature.properties?.distance_kilometers ?? null
                : null,
              source: 'bottle-of-rhumb-water-routing',
              ...(isRoute ? {
                featureColor: feature.properties?.requiresManualAdjustment
                  ? '#e09a3e'
                  : '#1e90ff',
                featureSize: 3,
                featureDash: feature.properties?.requiresManualAdjustment
                  ? 'dashed'
                  : 'solid',
              } : {}),
            },
          };
        }),
      };

      const added = addDerivedGeoJSON(
        drawRef.current,
        collection,
        activeLayerIdRef.current,
      );
      setFeatures(added.collection.features);
      const routeIndex = collection.features.findIndex(
        (feature) => feature.properties?.routeRole === 'route',
      );
      const routeId = added.addedIds[routeIndex];
      if (routeId !== undefined) {
        startDrawing(drawRef.current, 'select');
        selectFeature(drawRef.current, routeId);
        setSelectedFeatureIds([routeId]);
      }

      const route = collection.features[routeIndex];
      const kilometers = route?.properties?.distance_kilometers;
      const cached = route?.properties?.cache_hit === true;
      const manualSegments = route?.properties?.manualAdjustmentSegments ?? [];
      const requiresAdjustment = route?.properties?.requiresManualAdjustment === true;
      if (requiresAdjustment) {
        const segmentLabel = manualSegments.length > 0
          ? manualSegments.join(' and ')
          : 'highlighted';
        setWaterRouteStatus(
          `Route added, but the ${segmentLabel} harbor approach could not be calculated automatically. The route is selected—drag its vertices or midpoint handles around land before use.`,
        );
      } else {
        setWaterRouteStatus(
          `Water route added${Number.isFinite(kilometers) ? ` (${kilometers.toLocaleString()} km)` : ''}${cached ? ' from cache' : ''}. Drag its vertices to adjust it.`,
        );
      }
      window.setTimeout(() => setWaterRouteStatus(''), requiresAdjustment ? 15000 : 9000);
    } catch (caughtError) {
      if (caughtError.name === 'AbortError') {
        setWaterRouteStatus('Water route cancelled.');
        return;
      }
      const message = caughtError.message || 'The water route could not be created.';
      setError(message);
      setWaterRouteStatus(message);
    } finally {
      if (waterRouteAbortRef.current === abortController) {
        waterRouteAbortRef.current = null;
        setWaterRouteLoading(false);
      }
    }
  }

  function handleCancelRouting() {
    routingControllerRef.current?.cancel();
    quickRouteControllerRef.current?.cancel();
    waterRouteControllerRef.current?.cancel();
    waterRouteAbortRef.current?.abort();
    waterRouteAbortRef.current = null;
    setWaterRouteLoading(false);
    setWaterRouteStatus('');
  }

  async function handleRouteReady(payload, profile) {
    const summary = payload.summary ?? {};
    const collection = {
      ...payload.route,
      features: payload.route.features.map((feature, index) => ({
        ...feature,
        properties: {
          ...feature.properties,
          name: feature.properties?.name ?? `Land route${index ? ` ${index + 1}` : ''}`,
          routeProfile: profile,
          routeDistanceMeters: summary.distance_meters ?? null,
          routeDurationSeconds: summary.duration_seconds ?? null,
          source: 'openrouteservice',
        },
      })),
    };
    const added = addDerivedGeoJSON(drawRef.current, collection, activeLayerIdRef.current);
    setFeatures(added.collection.features);
  }

  async function handleAddressSearch(query) {
    try {
      setError('');
      return { ok: true, results: await searchAddresses(LAND_ROUTING_API_URL, query) };
    } catch (caughtError) {
      setError(caughtError.message);
      return { ok: false, error: caughtError.message, results: [] };
    }
  }

  function handlePreviewSearchResult(result) {
    const point = searchResultPoint(result);
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    mapRef.current?.flyTo({
      center: [point.lng, point.lat],
      zoom: Math.max(mapRef.current.getZoom(), 15),
      duration: 800,
    });
  }

  function handleAddSearchPoint(result) {
    try {
      const point = searchResultPoint(result);
      const collection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
          properties: {
            name: result.name || result.label || 'Search result',
            address: result.label || '',
            source: 'address-search',
          },
        }],
      };
      const added = addDerivedGeoJSON(drawRef.current, collection, activeLayerIdRef.current);
      setFeatures(added.collection.features);
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      return { ok: true };
    } catch (caughtError) {
      setError(caughtError.message);
      return { ok: false, error: caughtError.message };
    }
  }

  function handleAddReferencePoint(feature) {
    try {
      setError('');
      const collection = { type: 'FeatureCollection', features: [feature] };
      const added = addDerivedGeoJSON(drawRef.current, collection, activeLayerIdRef.current);
      setFeatures(added.collection.features);
      const addedId = added.addedIds.at(-1);
      if (addedId !== undefined) {
        selectFeature(drawRef.current, addedId);
        setSelectedFeatureIds([addedId]);
      }
      return { ok: true, id: addedId };
    } catch (caughtError) {
      setError(caughtError.message);
      throw caughtError;
    }
  }

  function handleUseSearchAsRouteStart(result, profile) {
    const point = searchResultPoint(result);
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    handleStartRouting(profile, point);
  }

  async function handlePopupImageUpload(file) {
    if (!selectedFeature) {
      return { ok: false, error: 'Select a feature before uploading an image.' };
    }

    try {
      setError('');
      const image = await uploadPopupImage(
        IMAGE_UPLOAD_API_URL,
        file,
        selectedFeature.id,
      );
      updateFeature(drawRef.current, selectedFeature.id, {
        popupImageUrl: image.imageUrl,
        popupImageKey: image.imageKey,
        popupImageAlt: selectedFeature.properties?.popupImageAlt || '',
        popupImageCaption: selectedFeature.properties?.popupImageCaption || '',
      });
      return { ok: true, image };
    } catch (caughtError) {
      const message = caughtError.message || 'Image upload failed.';
      setError(message);
      return { ok: false, error: message };
    }
  }

  async function handleLocateDevice() {
    try {
      setError('');

      if (!navigator.geolocation) {
        throw new Error('Device location is not supported by this browser.');
      }

      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 30000,
        });
      });

      const { longitude, latitude, accuracy } = position.coords;
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: Math.max(mapRef.current.getZoom(), 16),
        essential: true,
      });

      const collection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          properties: {
            name: 'Device location',
            source: 'device-geolocation',
            accuracyMeters: Math.round(accuracy),
          },
        }],
      };

      const added = addDerivedGeoJSON(
        drawRef.current,
        collection,
        activeLayerIdRef.current,
      );
      setFeatures(added.collection.features);
      return { ok: true };
    } catch (caughtError) {
      const messages = {
        1: 'Location permission was denied.',
        2: 'Your device location is currently unavailable.',
        3: 'Finding your device location timed out.',
      };
      const message = messages[caughtError?.code]
        || caughtError?.message
        || 'Unable to find your device location.';
      setError(message);
      return { ok: false, error: message };
    }
  }

  async function handleImport(file) {
    try {
      setError('');
      setDataImportStatus(`Reading ${file.name}…`);
      const collection = await readSpatialFile(file, {
        geocodeAddresses: (addresses) => geocodeCsvAddresses(
          addresses,
          authSession?.accessToken,
          setDataImportStatus,
        ),
      });
      const layerId = `layer-${crypto.randomUUID()}`;
      const loaded = addGeoJSON(
        drawRef.current,
        mapRef.current,
        collection,
        layerId,
      );
      const name = spatialFileLayerName(file.name);
      setLayers((current) => {
        const importedLayer = makeLayer(layerId, name, current.length);
        if (collection.importReport?.type === 'csv') {
          importedLayer.importReport = collection.importReport;
        }
        return [...current, importedLayer];
      });
      setActiveLayerId(layerId);
      setSelectedFeatureIds([]);
      setFeatures(loaded.features);
      const geocoded = collection.importReport?.coordinateSource === 'geoapify';
      setDataImportStatus(geocoded
        ? `Added ${collection.importReport.importedRows.toLocaleString()} geocoded CSV rows.`
        : 'Layer imported.');
      return { ok: true };
    } catch (caughtError) {
      setDataImportStatus('');
      setError(caughtError.message);
      return { ok: false, error: caughtError.message };
    }
  }

  async function handleDroppedImage(file) {
    try {
      setError('');
      const gps = await readImageGps(file);
      if (gps) {
        mapRef.current?.flyTo({
          center: [gps.longitude, gps.latitude],
          zoom: Math.max(mapRef.current.getZoom(), 14),
          essential: true,
        });
        await placeDroppedImage(file, [gps.longitude, gps.latitude], true);
        return;
      }
      armPhotoPlacement(file);
    } catch (caughtError) {
      setError(caughtError.message || 'The image could not be added to the map.');
    }
  }

  function armPhotoPlacement(file) {
    const map = mapRef.current;
    if (!map) throw new Error('The map is not ready.');

    photoPlacementCleanupRef.current?.();
    routingControllerRef.current?.cancel();
    quickRouteControllerRef.current?.cancel();
    waterRouteControllerRef.current?.cancel();
    startDrawing(drawRef.current, 'select');

    const canvas = map.getCanvas();
    const previousCursor = canvas.style.cursor;
    const tooltip = document.createElement('div');
    tooltip.textContent = 'Click the map to place photo.';
    tooltip.setAttribute('role', 'status');
    Object.assign(tooltip.style, {
      position: 'absolute',
      zIndex: '31',
      display: 'none',
      maxWidth: '290px',
      padding: '7px 10px',
      border: '1px solid rgba(255,255,255,.22)',
      borderRadius: '999px',
      background: '#172229',
      color: '#fff',
      boxShadow: '0 5px 18px rgba(0,0,0,.28)',
      font: '600 12px/1.25 Arial, Helvetica, sans-serif',
      pointerEvents: 'none',
      transform: 'translate(14px, 14px)',
      whiteSpace: 'nowrap',
    });
    map.getContainer().appendChild(tooltip);
    canvas.style.cursor = 'crosshair';

    const move = (event) => {
      tooltip.style.display = 'block';
      tooltip.style.left = `${event.point.x}px`;
      tooltip.style.top = `${event.point.y}px`;
    };
    const click = (event) => {
      const coordinates = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];
      cleanup();
      void placeDroppedImage(file, coordinates, false);
    };
    const keydown = (event) => {
      if (event.key === 'Escape') cleanup();
    };
    const cleanup = () => {
      map.off('mousemove', move);
      map.off('click', click);
      window.removeEventListener('keydown', keydown);
      tooltip.remove();
      canvas.style.cursor = previousCursor;
      if (photoPlacementCleanupRef.current === cleanup) {
        photoPlacementCleanupRef.current = null;
      }
    };

    map.on('mousemove', move);
    map.on('click', click);
    window.addEventListener('keydown', keydown);
    photoPlacementCleanupRef.current = cleanup;
  }

  async function placeDroppedImage(file, coordinates, usedExifGps) {
    const imageName = file.name.replace(/\.[^.]+$/, '') || 'Map photo';
    const collection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: {
          name: imageName,
          source: 'image-drop',
          imageLocationSource: usedExifGps ? 'exif-gps' : 'map-click',
          popupEnabled: true,
          popupTitle: imageName,
          popupDescription: '',
          popupImageAlt: imageName,
          popupImageCaption: '',
        },
      }],
    };

    const added = addDerivedGeoJSON(drawRef.current, collection, activeLayerIdRef.current);
    const featureId = added.addedIds.at(-1);
    setFeatures(added.collection.features);
    if (featureId === undefined) throw new Error('The photo point could not be created.');

    selectFeature(drawRef.current, featureId);
    setSelectedFeatureIds([featureId]);
    setFeatureEditorRequest({ featureId, tab: 'popup', token: crypto.randomUUID() });

    try {
      const image = await uploadPopupImage(IMAGE_UPLOAD_API_URL, file, featureId);
      updateFeature(drawRef.current, featureId, {
        popupImageUrl: image.imageUrl,
        popupImageKey: image.imageKey,
      });
    } catch (caughtError) {
      setError(`The point was added, but the image upload failed: ${caughtError.message}`);
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
    const files = Array.from(event.dataTransfer.files);
    const image = files.find(isSupportedPopupImage);
    if (image) {
      await handleDroppedImage(image);
      return;
    }
    const file = files.find(isSupportedSpatialFile);
    if (!file) {
      setError('Drop a JPEG, PNG, WebP, GeoJSON, CSV, KML, or GPX file onto the map.');
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

  function handleReorderLayer(sourceId, targetId) {
    if (sourceId === targetId) return;

    setLayers((current) => {
      const sourceIndex = current.findIndex((layer) => layer.id === sourceId);
      const targetIndex = current.findIndex((layer) => layer.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;

      const next = [...current];
      const [movedLayer] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, movedLayer);
      return next;
    });
  }

  function handleSelectFeature(id, options = {}) {
    mapRef.current?.rhumbWeatherControl?.disableWeather();

    if (options.rangeIds?.length) {
      setSelectedFeatureIds((current) => {
        const base = options.additiveRange ? current : [];
        const combined = [...base, ...options.rangeIds];
        const unique = combined.filter((candidate, index) => (
          combined.findIndex((value) => String(value) === String(candidate)) === index
        ));

        return [
          ...unique.filter((candidate) => String(candidate) !== String(id)),
          id,
        ];
      });
      selectFeature(drawRef.current, id, { additive: true });
      return;
    }

    selectFeature(drawRef.current, id, options);

    if (options.focus) {
      const feature = features.find(
        (candidate) => String(candidate.id) === String(id),
      );

      if (feature) fitMapToFeatures(mapRef.current, [feature]);
    }
  }

  function handleSelectionChange(id, { additive = false } = {}) {
    if (id === null || id === undefined) {
      if (!additive) setSelectedFeatureIds([]);
      return;
    }

    if (viewerMode) {
      previewFeaturePopup(
        drawRef.current,
        mapRef.current,
        id,
        legendRef.current,
      );
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
      setHiddenLayers(drawRef.current, mapRef.current, drawingHiddenLayerIds(next));
      return next;
    });
  }

  function handleDeleteFeature() {
    if (selectedFeatureIds.length === 0) return;
    deleteFeatures(drawRef.current, selectedFeatureIds);
    setSelectedFeatureIds([]);
  }

  function handleDeleteFeatureById(featureId) {
    if (featureId === null || featureId === undefined) return;
    deleteFeatures(drawRef.current, [featureId]);
    setSelectedFeatureIds((current) => current.filter(
      (id) => String(id) !== String(featureId),
    ));
  }

  function handleDuplicateFeature(featureId) {
    try {
      setError('');
      const source = features.find((feature) => String(feature.id) === String(featureId));
      if (!source) throw new Error('The selected feature could not be found.');

      const duplicate = structuredClone(source);
      delete duplicate.id;
      duplicate.geometry.coordinates = offsetCoordinates(
        duplicate.geometry.coordinates,
        0.001,
        -0.001,
      );
      duplicate.properties = {
        ...duplicate.properties,
        name: duplicate.properties?.name
          ? `${duplicate.properties.name} copy`
          : `${duplicate.geometry.type} copy`,
      };
      delete duplicate.properties.selected;
      delete duplicate.properties.currentlyDrawing;

      const layerId = source.properties?.layerId ?? activeLayerId;
      const added = addDerivedGeoJSON(
        drawRef.current,
        { type: 'FeatureCollection', features: [duplicate] },
        layerId,
      );
      const duplicateId = added.addedIds.at(-1);
      setFeatures(added.collection.features);

      if (duplicateId !== undefined) {
        selectFeature(drawRef.current, duplicateId);
        setSelectedFeatureIds([duplicateId]);
      }
    } catch (caughtError) {
      setError(caughtError.message || 'The feature could not be duplicated.');
    }
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
      drawingHiddenLayerIds(nextLayers),
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
    const restoredView = getMapView(mapRef.current);

    setMapReady(false);
    routingControllerRef.current?.destroy();
    routingControllerRef.current = null;
    quickRouteControllerRef.current?.destroy();
    quickRouteControllerRef.current = null;
    waterRouteControllerRef.current?.destroy();
    waterRouteControllerRef.current = null;
    waterRouteAbortRef.current?.abort();
    waterRouteAbortRef.current = null;
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    mapRef.current.rhumbWeatherControl?.disableWeather();
    removeFeatureAppearanceLayers(mapRef.current);
    removeLayerVisualizations(mapRef.current);
    mapRef.current.remove();
    drawRef.current = null;
    mapRef.current = null;
    mapContainerRef.current?.replaceChildren();

    mountMap(
      nextId,
      restoredFeatures,
      restoredLayers,
      restoredSelection,
      restoredView,
      projection,
    );
    setLegend((current) => ({
      ...current,
      ...getBasemapStyleDefaults(nextId).legend,
    }));
    setMapControls((current) => ({
      ...current,
      ...getBasemapStyleDefaults(nextId).controls,
    }));
    setBasemapId(nextId);
  }

  function handleProjectionChange(nextProjection) {
    const normalized = nextProjection === 'globe' ? 'globe' : 'mercator';
    setProjection(normalized);
    mapRef.current?.rhumbWeatherControl?.setPreferredProjection(normalized);
  }

  function handleLegendChange(changes) {
    setLegend((current) => ({ ...current, ...changes }));
  }

  function handleMapControlsChange(changes) {
    setMapControls((current) => ({ ...current, ...changes }));
  }

  function handleLegendLayerChange(id, changes) {
    setLayers((current) => current.map((layer) => (
      layer.id === id ? { ...layer, ...changes } : layer
    )));
  }

  function handleLayerVisualizationChange(id, changes) {
    setLayers((current) => current.map((layer) => (
      layer.id === id
        ? {
          ...layer,
          visualization: {
            ...DEFAULT_LAYER_VISUALIZATION,
            ...(layer.visualization ?? {}),
            ...changes,
          },
        }
        : layer
    )));
    setSelectedFeatureIds([]);
  }

  function buildSavedDocument() {
    return {
      title: mapTitle,
      description: mapDescription,
      visibility: mapVisibility,
      basemapId,
      projection,
      view: savedView || getMapView(mapRef.current),
      legend,
      mapControls,
      layers,
      activeLayerId,
      featureCollection: {
        type: 'FeatureCollection',
        features,
      },
      revision: mapRevision,
    };
  }

  async function handleSaveMap() {
    if (!authSession?.accessToken) {
      setSaveStatus('Sign in before saving this map.');
      return;
    }

    setSaveStatus('Saving map…');
    try {
      const document = buildSavedDocument();
      const saved = mapId && ownsMap
        ? await updateSavedMap(mapId, document, authSession.accessToken)
        : await createSavedMap(document, authSession.accessToken);

      setMapId(saved.mapId);
      setMapRevision(saved.revision);
      setOwnsMap(true);
      setMapVisibility(saved.visibility);
      setSaveStatus(saved.visibility === 'published'
        ? 'Map saved and published.'
        : 'Draft saved.');

      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('map', saved.mapId);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

      const maps = await listSavedMaps(authSession.accessToken);
      setMyMaps(maps);
      setMyMapsStatus(maps.length === 0 ? 'No saved maps yet.' : '');
    } catch (caughtError) {
      setSaveStatus(caughtError.message || 'The map could not be saved.');
    }
  }

  function handleOpenSavedMap(savedMapId) {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin);
    url.searchParams.set('map', savedMapId);
    window.location.assign(url.toString());
  }

  async function handleDeleteSavedMap(savedMap) {
    if (!authSession?.accessToken || !savedMap?.mapId) return;
    const title = savedMap.title || 'Untitled map';
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;

    setMyMapsStatus('Deleting map…');
    try {
      await deleteSavedMap(savedMap.mapId, authSession.accessToken);
      if (String(savedMap.mapId) === String(mapId)) {
        window.location.assign(new URL(import.meta.env.BASE_URL, window.location.origin).toString());
        return;
      }
      setMyMaps((current) => current.filter(
        (candidate) => String(candidate.mapId) !== String(savedMap.mapId),
      ));
      setMyMapsStatus('Map deleted.');
    } catch (caughtError) {
      setMyMapsStatus(caughtError.message || 'The map could not be deleted.');
    }
  }

  async function handleSignIn(mode = 'login') {
    try {
      await signIn(mode);
    } catch (caughtError) {
      setError(caughtError.message);
    }
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

  function ensureTutorialLayer() {
    activeLayerIdRef.current = TUTORIAL_LAYER_ID;
    setActiveLayerId(TUTORIAL_LAYER_ID);
    setLayers((current) => (
      current.some((layer) => layer.id === TUTORIAL_LAYER_ID)
        ? current
        : [...current, makeLayer(TUTORIAL_LAYER_ID, 'Tutorial route', current.length)]
    ));
  }

  function ensureTutorialPoints() {
    const existing = tutorialFeatureIdsRef.current.points.filter((id) => (
      features.some((feature) => String(feature.id) === String(id))
    ));
    if (existing.length === 2) return existing;

    ensureTutorialLayer();
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-87.605, 41.888] },
          properties: {
            name: 'Chicago Harbor',
            description: 'Sample starting point on Lake Michigan.',
            labelEnabled: true,
            labelText: 'Chicago',
            popupEnabled: true,
            popupTitle: 'Chicago Harbor',
            popupDescription: 'The starting point for the tutorial route.',
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-87.893, 43.035] },
          properties: {
            name: 'Milwaukee Harbor',
            description: 'Sample ending point on Lake Michigan.',
            labelEnabled: true,
            labelText: 'Milwaukee',
            popupEnabled: true,
            popupTitle: 'Milwaukee Harbor',
            popupDescription: 'The ending point for the tutorial route.',
          },
        },
      ],
    };
    const added = addDerivedGeoJSON(drawRef.current, collection, TUTORIAL_LAYER_ID);
    tutorialFeatureIdsRef.current.points = added.addedIds;
    setFeatures(added.collection.features);
    return added.addedIds;
  }

  function ensureTutorialRoute() {
    const existing = tutorialFeatureIdsRef.current.route.filter((id) => (
      features.some((feature) => String(feature.id) === String(id))
    ));
    if (existing.length > 0) return existing;

    ensureTutorialPoints();
    const collection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-87.605, 41.888],
            [-87.548, 42.18],
            [-87.61, 42.52],
            [-87.74, 42.78],
            [-87.893, 43.035],
          ],
        },
        properties: {
          name: 'Lake Michigan sample route',
          description: 'A demonstration route between Chicago and Milwaukee.',
          featureColor: '#e6643c',
          featureSize: 4,
          popupEnabled: true,
          popupTitle: 'Lake Michigan route',
          popupDescription: 'This route can also be imported from GPX, KML, or GeoJSON.',
        },
      }],
    };
    const added = addDerivedGeoJSON(drawRef.current, collection, TUTORIAL_LAYER_ID);
    tutorialFeatureIdsRef.current.route = added.addedIds;
    setFeatures(added.collection.features);
    return added.addedIds;
  }

  function showTutorialStep(step) {
    if (!mapReady) return;
    setTutorialStep(step);

    if (step <= 1) {
      mapRef.current?.easeTo({ center: TUTORIAL_CENTER, zoom: 6.1, bearing: 0, pitch: 0, duration: 1200 });
    }
    if (step === 2) ensureTutorialPoints();
    if (step === 3) {
      const [startId] = ensureTutorialPoints();
      if (startId !== undefined) {
        selectFeature(drawRef.current, startId);
        setSelectedFeatureIds([startId]);
      }
    }
    if (step === 4) ensureTutorialRoute();
  }

  function closeTutorial() {
    setTutorialStep(null);

    const tutorialIds = new Set([
      ...tutorialFeatureIdsRef.current.points,
      ...tutorialFeatureIdsRef.current.route,
    ].map(String));
    const tutorialLayerExists = layers.some((layer) => layer.id === TUTORIAL_LAYER_ID);

    if (tutorialLayerExists && drawRef.current) {
      deleteLayerFeatures(drawRef.current, TUTORIAL_LAYER_ID);
    }

    tutorialFeatureIdsRef.current = { points: [], route: [] };
    setFeatures((current) => current.filter(
      (feature) => feature.properties?.layerId !== TUTORIAL_LAYER_ID,
    ));
    setSelectedFeatureIds((current) => current.filter(
      (id) => !tutorialIds.has(String(id)),
    ));

    if (tutorialLayerExists) {
      const remainingLayers = layers.filter((layer) => layer.id !== TUTORIAL_LAYER_ID);
      const nextLayers = remainingLayers.length > 0 ? remainingLayers : [DEFAULT_LAYER];
      const nextActiveId = activeLayerId === TUTORIAL_LAYER_ID
        ? nextLayers[0].id
        : activeLayerId;

      activeLayerIdRef.current = nextActiveId;
      setLayers(nextLayers);
      setActiveLayerId(nextActiveId);
      setHiddenLayers(
        drawRef.current,
        mapRef.current,
        drawingHiddenLayerIds(nextLayers),
      );
    }
  }

  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
  const selectedFeature = features.find(
    (feature) => String(feature.id) === String(selectedFeatureId),
  );
  const selectedFeatures = selectedFeatureIds
    .map((id) => features.find((feature) => String(feature.id) === String(id)))
    .filter(Boolean);
  const editorThemeStyle = {
    '--editor-panel-background': hexToRgba(
      legend.backgroundColor,
      legend.backgroundOpacity / 100,
    ),
    '--editor-panel-color': legend.textColor,
    '--editor-panel-muted': hexToRgba(legend.textColor, 0.72),
    '--editor-panel-soft': hexToRgba(legend.textColor, 0.09),
    '--editor-panel-hover': hexToRgba(legend.textColor, 0.15),
    '--editor-panel-border': hexToRgba(
      legend.borderColor,
      legend.borderOpacity / 100,
    ),
    '--editor-panel-border-width': `${legend.borderWidth}px`,
    '--editor-panel-radius': `${legend.borderRadius}px`,
    '--editor-panel-font': legendFontFamily(legend.fontFamily),
    '--editor-panel-shadow': legend.glowEnabled
      ? `0 0 ${legend.glowSize}px ${legend.glowColor}, 0 14px 38px rgba(0,0,0,.35)`
      : '0 14px 38px rgba(0,0,0,.35)',
  };

  return (
    <main
      className={`app-shell ${dragActive ? 'is-dragging-file' : ''} ${viewerMode ? 'is-viewer' : ''} ${embedMode ? 'is-embed' : ''}`}
      style={editorThemeStyle}
      onDragEnter={viewerMode ? undefined : handleDragEnter}
      onDragLeave={viewerMode ? undefined : handleDragLeave}
      onDragOver={viewerMode ? undefined : handleDragOver}
      onDrop={viewerMode ? undefined : handleDrop}
      onContextMenu={viewerMode ? undefined : handleMapContextMenu}
    >
      <div ref={mapContainerRef} className="map-canvas" />
      <MapLegend legend={legend} layers={layers} features={features} />
      {!viewerMode && drawingContextMenu && (
        <DrawingContextMenu
          activeLayerName={activeLayer?.name}
          position={drawingContextMenu}
          onChoose={handleContextTool}
          onClose={() => setDrawingContextMenu(null)}
        />
      )}
      {!viewerMode && (
        <>
          <AppHeader
            onStartTutorial={() => showTutorialStep(0)}
            tutorialActive={tutorialStep !== null}
          />
          <EditorToolbar
            activeLayer={activeLayer}
            disabled={!mapReady}
            featureCount={features.length}
            onDraw={handleDraw}
            onAddSearchPoint={handleAddSearchPoint}
            onAddressSearch={handleAddressSearch}
            onLocateDevice={handleLocateDevice}
            onCancelRouting={handleCancelRouting}
            onPreviewSearchResult={handlePreviewSearchResult}
            onSetView={handleSaveView}
            onStartRouting={handleStartRouting}
            onStartQuickRoute={handleStartQuickRoute}
            onStartWaterRoute={handleStartWaterRoute}
            onUseSearchAsRouteStart={handleUseSearchAsRouteStart}
            routingActive={routingActive || quickRouteActive || waterRouteActive || waterRouteLoading}
            routingStatus={waterRouteStatus || quickRouteStatus || routingStatus}
            viewSaved={Boolean(savedView)}
            tutorialDrawMenuOpen={tutorialStep === 2 || tutorialStep === 4}
          />
        </>
      )}
      {waterRouteLoading && (
        <div className="water-route-loading" role="status" aria-live="polite">
          <span className="water-route-spinner" aria-hidden="true" />
          <div>
            <strong>Calculating water route…</strong>
            <span>Coastal and harbor routes may take several seconds.</span>
          </div>
        </div>
      )}
      {!viewerMode && <Menu
        authSession={authSession}
        activeLayerId={activeLayerId}
        basemapId={basemapId}
        basemaps={BASEMAPS}
        projection={projection}
        disabled={!mapReady}
        features={features}
        layers={layers}
        legend={legend}
        mapControls={mapControls}
        mapDescription={mapDescription}
        mapId={mapId}
        mapTitle={mapTitle}
        mapVisibility={mapVisibility}
        myMaps={myMaps}
        myMapsStatus={myMapsStatus}
        ownsMap={ownsMap}
        saveStatus={saveStatus}
        selectedFeatureId={selectedFeatureId}
        selectedFeatureIds={selectedFeatureIds}
        savedView={savedView}
        viewMessage={viewMessage}
        onAddLayer={handleAddLayer}
        onBasemapChange={handleBasemapChange}
        onProjectionChange={handleProjectionChange}
        onExport={() => exportGeoJSON(drawRef.current)}
        onImport={handleImport}
        onApplyGeoJSON={handleApplyGeoJSON}
        onClearView={handleClearView}
        onDeleteLayer={handleDeleteLayer}
        onDeleteFeature={handleDeleteFeatureById}
        onDuplicateFeature={handleDuplicateFeature}
        onLayerChange={setActiveLayerId}
        onLayerVisualizationChange={handleLayerVisualizationChange}
        onLegendChange={handleLegendChange}
        onMapControlsChange={handleMapControlsChange}
        onLegendLayerChange={handleLegendLayerChange}
        onRenameLayer={handleRenameLayer}
        onSelectFeature={handleSelectFeature}
        onFitToFeatures={handleFitToFeatures}
        onPreviewView={handlePreviewView}
        onReorderLayer={handleReorderLayer}
        onSaveView={handleSaveView}
        onToggleLayer={handleToggleLayer}
        onCreateAccount={() => handleSignIn('signup')}
        onMapDescriptionChange={setMapDescription}
        onMapTitleChange={setMapTitle}
        onMapVisibilityChange={setMapVisibility}
        onDeleteSavedMap={handleDeleteSavedMap}
        onOpenSavedMap={handleOpenSavedMap}
        onSaveMap={handleSaveMap}
        onSignIn={() => handleSignIn('login')}
        onSignOut={() => signOut()}
        tutorialExpanded={tutorialStep !== null ? true : undefined}
        tutorialSection={tutorialStep === null
          ? undefined
          : ['map', 'map', 'layers', 'layers', 'data', 'share'][tutorialStep]}
      />}
      {!viewerMode && <FeatureEditor
        basemapId={basemapId}
        feature={selectedFeature}
        features={selectedFeatures}
        onDelete={handleDeleteFeature}
        onGeometryOperation={handleGeometryOperation}
        onImageUpload={handlePopupImageUpload}
        onPreview={() => previewFeaturePopup(
          drawRef.current,
          mapRef.current,
          selectedFeatureId,
          getBasemapStyleDefaults(basemapId).popup,
        )}
        onUpdate={(properties) => updateFeature(drawRef.current, selectedFeatureId, properties)}
        openRequest={featureEditorRequest}
        tutorialExpanded={tutorialStep === 3 ? false : undefined}
      />}
      {!viewerMode && <Tutorial
        step={tutorialStep}
        onBack={() => showTutorialStep(Math.max(0, tutorialStep - 1))}
        onClose={closeTutorial}
        onNext={() => showTutorialStep(Math.min(5, tutorialStep + 1))}
      />}

      {dragActive && (
        <div className="geojson-drop-overlay" aria-hidden="true">
          <div>
            <strong>Drop a map file or photo</strong>
            <span>GeoJSON, CSV, KML, GPX, JPEG, PNG, or WebP</span>
          </div>
        </div>
      )}

      {!mapReady && !error && (
        <div className="loading-card" role="status">
          <div className="loading-compass">⌖</div>
          <span>Loading chart…</span>
        </div>
      )}

      {dataImportStatus && mapReady && !error && (
        <div className="data-import-status" role="status">
          <span className="data-import-status-spinner" aria-hidden="true">⌖</span>
          <span>{dataImportStatus}</span>
          <button type="button" aria-label="Dismiss import status" onClick={() => setDataImportStatus('')}>×</button>
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
        border: `${legend.borderWidth}px solid ${hexToRgba(legend.borderColor, legend.borderOpacity / 100)}`,
        borderRadius: `${legend.borderRadius}px`,
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

function offsetCoordinates(value, longitudeOffset, latitudeOffset) {
  if (!Array.isArray(value)) return value;
  if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return [
      Number((value[0] + longitudeOffset).toFixed(6)),
      Number((value[1] + latitudeOffset).toFixed(6)),
      ...value.slice(2),
    ];
  }
  return value.map((child) => offsetCoordinates(child, longitudeOffset, latitudeOffset));
}

