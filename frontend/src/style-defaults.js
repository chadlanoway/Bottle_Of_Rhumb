const COMMON = {
  feature: {
    color: '#1e90ff', opacity: 100, pointSize: 6, lineWidth: 3, dash: 'solid',
    fillColor: '#1e90ff', fillOpacity: 32,
    borderColor: '#ffffff', borderOpacity: 100, pointBorderWidth: 2, lineBorderWidth: 2, polygonBorderWidth: 3,
    glowEnabled: false, glowColor: '#1e90ff', glowSize: 10, glowOpacity: 45,
  },
  popup: {
    backgroundColor: '#172229', backgroundOpacity: 92, textColor: '#ffffff', fontFamily: 'sans',
    borderColor: '#ffffff', borderOpacity: 20, borderWidth: 1, borderRadius: 8, maxWidth: 420,
    glowEnabled: false, glowColor: '#1e90ff', glowSize: 18,
  },
  text: {
    fontFamily: 'sans', color: '#172229', size: 16,
    haloColor: '#ffffff', haloWidth: 1.2,
    backgroundColor: '#ffffff', backgroundRounded: true, backgroundShadow: true,
  },
  legend: {
    backgroundColor: '#172229', backgroundOpacity: 90, textColor: '#ffffff', fontFamily: 'sans',
    borderColor: '#ffffff', borderOpacity: 20, borderWidth: 1, borderRadius: 7,
    glowEnabled: false, glowColor: '#1e90ff', glowSize: 18,
  },
  controls: {
    backgroundColor: '#10191e', backgroundOpacity: 94,
    iconColor: '#eef5f8', accentColor: '#1e90ff', activeTextColor: '#06121a',
    borderColor: '#ffffff', borderOpacity: 18, borderWidth: 1, borderRadius: 24,
    glowEnabled: false, glowColor: '#1e90ff', glowSize: 18,
  },
};

const THEMES = {
  positron: {
    feature: {
      color: '#0067c5', opacity: 96, pointSize: 7, lineWidth: 4,
      fillColor: '#4eb7e8', fillOpacity: 24,
      borderColor: '#f8fbff', borderOpacity: 100,
      pointBorderWidth: 2, lineBorderWidth: 2, polygonBorderWidth: 3,
      glowEnabled: false, glowColor: '#53c7ff', glowSize: 8, glowOpacity: 28,
    },
    popup: {
      backgroundColor: '#152b38', backgroundOpacity: 96, textColor: '#f5fbff',
      borderColor: '#63b9d7', borderOpacity: 72, borderWidth: 1,
      borderRadius: 5, maxWidth: 400, glowEnabled: false, glowColor: '#4eb7e8', glowSize: 12,
    },
    text: { color: '#102d3a', size: 16, haloColor: '#ffffff', haloWidth: 1.6, backgroundColor: '#f7fbfd' },
    legend: { backgroundColor: '#152b38', backgroundOpacity: 94, textColor: '#f5fbff', glowEnabled: false },
    controls: { backgroundColor: '#152b38', iconColor: '#f5fbff', accentColor: '#4eb7e8', activeTextColor: '#102d3a', borderColor: '#63b9d7', borderOpacity: 72, borderWidth: 1, borderRadius: 24, glowEnabled: false },
  },

  liberty: {
    feature: {
      color: '#b7462c', opacity: 100, pointSize: 8, lineWidth: 4,
      fillColor: '#d9825b', fillOpacity: 38,
      borderColor: '#4b3327', borderOpacity: 92,
      pointBorderWidth: 3, lineBorderWidth: 2, polygonBorderWidth: 3,
      glowEnabled: false, glowColor: '#e7ad78', glowSize: 10, glowOpacity: 32,
    },
    popup: {
      backgroundColor: '#ead8b8', backgroundOpacity: 97, textColor: '#38291f', fontFamily: 'serif',
      borderColor: '#74523a', borderOpacity: 88, borderWidth: 2,
      borderRadius: 3, maxWidth: 430, glowEnabled: false, glowColor: '#c88b5c', glowSize: 10,
    },
    text: { fontFamily: 'serif', color: '#432e22', size: 17, haloColor: '#fff7e8', haloWidth: 1.8, backgroundColor: '#f2e5ca' },
    legend: { backgroundColor: '#ead8b8', backgroundOpacity: 96, textColor: '#38291f', fontFamily: 'serif', glowEnabled: false },
    controls: { backgroundColor: '#ead8b8', backgroundOpacity: 97, iconColor: '#38291f', accentColor: '#b7462c', activeTextColor: '#fff7e8', borderColor: '#74523a', borderOpacity: 88, borderWidth: 2, borderRadius: 8, glowEnabled: false },
  },

  bright: {
    feature: {
      color: '#1746c7', opacity: 100, pointSize: 9, lineWidth: 5,
      fillColor: '#ffca28', fillOpacity: 42,
      borderColor: '#fff4a8', borderOpacity: 100,
      pointBorderWidth: 3, lineBorderWidth: 3, polygonBorderWidth: 4,
      glowEnabled: false, glowColor: '#ffd740', glowSize: 12, glowOpacity: 35,
    },
    popup: {
      backgroundColor: '#fff4b8', backgroundOpacity: 98, textColor: '#17375e',
      borderColor: '#1746c7', borderOpacity: 100, borderWidth: 3,
      borderRadius: 12, maxWidth: 440, glowEnabled: false, glowColor: '#ffc400', glowSize: 9,
    },
    text: { color: '#17375e', size: 17, haloColor: '#ffffff', haloWidth: 2, backgroundColor: '#fff4b8' },
    legend: { backgroundColor: '#fff4b8', backgroundOpacity: 97, textColor: '#17375e', glowEnabled: false, glowColor: '#ffc400', glowSize: 9 },
    controls: { backgroundColor: '#fff4b8', backgroundOpacity: 98, iconColor: '#17375e', accentColor: '#1746c7', activeTextColor: '#ffffff', borderColor: '#1746c7', borderOpacity: 100, borderWidth: 3, borderRadius: 18, glowEnabled: false, glowColor: '#ffc400', glowSize: 9 },
  },

  dark: {
    feature: {
      color: '#33e1ff', opacity: 100, pointSize: 8, lineWidth: 4,
      fillColor: '#8b5cf6', fillOpacity: 34,
      borderColor: '#ff4fd8', borderOpacity: 96,
      pointBorderWidth: 3, lineBorderWidth: 2, polygonBorderWidth: 3,
      glowEnabled: true, glowColor: '#00d9ff', glowSize: 18, glowOpacity: 68,
    },
    popup: {
      backgroundColor: '#0a0d18', backgroundOpacity: 93, textColor: '#e9fbff',
      borderColor: '#ff4fd8', borderOpacity: 95, borderWidth: 2,
      borderRadius: 14, maxWidth: 450, glowEnabled: true, glowColor: '#00d9ff', glowSize: 26,
    },
    text: { color: '#7ff3ff', size: 17, haloColor: '#080b14', haloWidth: 2.4, backgroundColor: '#111528' },
    legend: { backgroundColor: '#0a0d18', backgroundOpacity: 91, textColor: '#e9fbff', glowEnabled: true, glowColor: '#ff4fd8', glowSize: 20 },
    controls: { backgroundColor: '#0a0d18', backgroundOpacity: 93, iconColor: '#33e1ff', accentColor: '#ff4fd8', activeTextColor: '#0a0d18', borderColor: '#33e1ff', borderOpacity: 95, borderWidth: 2, borderRadius: 24, glowEnabled: true, glowColor: '#00d9ff', glowSize: 22 },
  },

  fiord: {
    feature: {
      color: '#ff8a55', opacity: 100, pointSize: 8, lineWidth: 5,
      fillColor: '#7ed6c4', fillOpacity: 27,
      borderColor: '#ffe5c7', borderOpacity: 100,
      pointBorderWidth: 2, lineBorderWidth: 2, polygonBorderWidth: 4,
      glowEnabled: false, glowColor: '#ff8758', glowSize: 11, glowOpacity: 42,
    },
    popup: {
      backgroundColor: '#102d3b', backgroundOpacity: 96, textColor: '#fff0dc',
      borderColor: '#71cbbb', borderOpacity: 80, borderWidth: 2,
      borderRadius: 2, maxWidth: 420, glowEnabled: false, glowColor: '#ff8758', glowSize: 13,
    },
    text: { color: '#fff0dc', size: 16, haloColor: '#102d3b', haloWidth: 2.2, backgroundColor: '#173d4b' },
    legend: { backgroundColor: '#102d3b', backgroundOpacity: 95, textColor: '#fff0dc', glowEnabled: false, glowColor: '#ff8758', glowSize: 11 },
    controls: { backgroundColor: '#102d3b', backgroundOpacity: 96, iconColor: '#fff0dc', accentColor: '#ff8a55', activeTextColor: '#102d3b', borderColor: '#71cbbb', borderOpacity: 80, borderWidth: 2, borderRadius: 10, glowEnabled: false },
  },

  hiking: {
    feature: {
      color: '#c94f24', opacity: 100, pointSize: 8, lineWidth: 4,
      fillColor: '#7f9a55', fillOpacity: 35,
      borderColor: '#4a3926', borderOpacity: 95,
      pointBorderWidth: 3, lineBorderWidth: 2, polygonBorderWidth: 3,
      glowEnabled: false, glowColor: '#e39a54', glowSize: 8, glowOpacity: 25,
    },
    popup: {
      backgroundColor: '#e7d7b5', backgroundOpacity: 98, textColor: '#3b3023', fontFamily: 'serif',
      borderColor: '#5b4931', borderOpacity: 92, borderWidth: 2,
      borderRadius: 0, maxWidth: 410, glowEnabled: false, glowColor: '#a27b48', glowSize: 8,
    },
    text: { fontFamily: 'serif', color: '#403324', size: 17, haloColor: '#f7edd7', haloWidth: 2, backgroundColor: '#eadbbd', backgroundRounded: false },
    legend: { backgroundColor: '#e7d7b5', backgroundOpacity: 97, textColor: '#3b3023', fontFamily: 'serif', glowEnabled: false },
    controls: { backgroundColor: '#e7d7b5', backgroundOpacity: 98, iconColor: '#3b3023', accentColor: '#c94f24', activeTextColor: '#fff8e6', borderColor: '#5b4931', borderOpacity: 92, borderWidth: 2, borderRadius: 4, glowEnabled: false },
  },

  nautical: {
    feature: {
      color: '#d4145a', opacity: 100, pointSize: 9, lineWidth: 4,
      fillColor: '#f0c75e', fillOpacity: 29,
      borderColor: '#071f31', borderOpacity: 100,
      pointBorderWidth: 3, lineBorderWidth: 2, polygonBorderWidth: 4,
      glowEnabled: false, glowColor: '#ff4f8d', glowSize: 9, glowOpacity: 35,
    },
    popup: {
      backgroundColor: '#082b40', backgroundOpacity: 97, textColor: '#f7e8c2', fontFamily: 'serif',
      borderColor: '#d9b85f', borderOpacity: 100, borderWidth: 3,
      borderRadius: 1, maxWidth: 460, glowEnabled: false, glowColor: '#d9b85f', glowSize: 8,
    },
    text: { fontFamily: 'serif', color: '#8d0f42', size: 17, haloColor: '#fffdf5', haloWidth: 2, backgroundColor: '#f4e6bd', backgroundRounded: false },
    legend: { backgroundColor: '#082b40', backgroundOpacity: 97, textColor: '#f7e8c2', fontFamily: 'serif', glowEnabled: false, glowColor: '#d9b85f', glowSize: 8 },
    controls: { backgroundColor: '#082b40', backgroundOpacity: 97, iconColor: '#f7e8c2', accentColor: '#d9b85f', activeTextColor: '#082b40', borderColor: '#d9b85f', borderOpacity: 100, borderWidth: 3, borderRadius: 3, glowEnabled: false },
  },

  cycling: {
    feature: {
      color: '#16834b', opacity: 100, pointSize: 7, lineWidth: 6,
      fillColor: '#b7db72', fillOpacity: 31,
      borderColor: '#4a214f', borderOpacity: 100,
      pointBorderWidth: 3, lineBorderWidth: 2, polygonBorderWidth: 3,
      glowEnabled: false, glowColor: '#77dd77', glowSize: 8, glowOpacity: 32,
    },
    popup: {
      backgroundColor: '#f2ead5', backgroundOpacity: 98, textColor: '#301c35',
      borderColor: '#16834b', borderOpacity: 100, borderWidth: 3,
      borderRadius: 18, maxWidth: 400, glowEnabled: false, glowColor: '#77c957', glowSize: 7,
    },
    text: { color: '#301c35', size: 16, haloColor: '#fffdf6', haloWidth: 2, backgroundColor: '#f2ead5' },
    legend: { backgroundColor: '#f2ead5', backgroundOpacity: 97, textColor: '#301c35', glowEnabled: false, glowColor: '#77c957', glowSize: 7 },
    controls: { backgroundColor: '#f2ead5', backgroundOpacity: 98, iconColor: '#301c35', accentColor: '#16834b', activeTextColor: '#ffffff', borderColor: '#16834b', borderOpacity: 100, borderWidth: 3, borderRadius: 24, glowEnabled: false },
  },

  winter: {
    feature: {
      color: '#0573b6', opacity: 96, pointSize: 8, lineWidth: 4,
      fillColor: '#bcecff', fillOpacity: 46,
      borderColor: '#ffffff', borderOpacity: 100,
      pointBorderWidth: 4, lineBorderWidth: 3, polygonBorderWidth: 5,
      glowEnabled: false, glowColor: '#9de7ff', glowSize: 20, glowOpacity: 58,
    },
    popup: {
      backgroundColor: '#e8f8ff', backgroundOpacity: 92, textColor: '#123f5a',
      borderColor: '#ffffff', borderOpacity: 100, borderWidth: 4,
      borderRadius: 20, maxWidth: 440, glowEnabled: false, glowColor: '#70d8ff', glowSize: 22,
    },
    text: { color: '#0b4e72', size: 17, haloColor: '#ffffff', haloWidth: 2.4, backgroundColor: '#e8f8ff' },
    legend: { backgroundColor: '#e8f8ff', backgroundOpacity: 92, textColor: '#123f5a', glowEnabled: false, glowColor: '#70d8ff', glowSize: 20 },
    controls: { backgroundColor: '#e8f8ff', backgroundOpacity: 92, iconColor: '#123f5a', accentColor: '#0573b6', activeTextColor: '#ffffff', borderColor: '#ffffff', borderOpacity: 100, borderWidth: 4, borderRadius: 28, glowEnabled: false, glowColor: '#70d8ff', glowSize: 20 },
  },

  seafloor: {
    feature: {
      color: '#f9e547', opacity: 100, pointSize: 8, lineWidth: 3,
      fillColor: '#00d4b8', fillOpacity: 24,
      borderColor: '#001d3d', borderOpacity: 100,
      pointBorderWidth: 3, lineBorderWidth: 3, polygonBorderWidth: 4,
      glowEnabled: false, glowColor: '#53ffe2', glowSize: 17, glowOpacity: 64,
    },
    popup: {
      backgroundColor: '#001b33', backgroundOpacity: 94, textColor: '#dffef8', fontFamily: 'mono',
      borderColor: '#f9e547', borderOpacity: 100, borderWidth: 2,
      borderRadius: 0, maxWidth: 470, glowEnabled: false, glowColor: '#53ffe2', glowSize: 18,
    },
    text: { fontFamily: 'mono', color: '#f9e547', size: 15, haloColor: '#001b33', haloWidth: 2, backgroundColor: '#002b47', backgroundRounded: false },
    legend: { backgroundColor: '#001b33', backgroundOpacity: 94, textColor: '#dffef8', fontFamily: 'mono', glowEnabled: false, glowColor: '#53ffe2', glowSize: 16 },
    controls: { backgroundColor: '#001b33', backgroundOpacity: 94, iconColor: '#f9e547', accentColor: '#53ffe2', activeTextColor: '#001b33', borderColor: '#f9e547', borderOpacity: 100, borderWidth: 2, borderRadius: 2, glowEnabled: false },
  },

  americana: {
    feature: {
      color: '#b52e2b', opacity: 100, pointSize: 10, lineWidth: 5,
      fillColor: '#e0b765', fillOpacity: 38,
      borderColor: '#17395c', borderOpacity: 100,
      pointBorderWidth: 4, lineBorderWidth: 3, polygonBorderWidth: 4,
      glowEnabled: false, glowColor: '#d26550', glowSize: 8, glowOpacity: 25,
    },
    popup: {
      backgroundColor: '#ead7ac', backgroundOpacity: 99, textColor: '#17395c', fontFamily: 'serif',
      borderColor: '#17395c', borderOpacity: 100, borderWidth: 4,
      borderRadius: 0, maxWidth: 450, glowEnabled: false, glowColor: '#b52e2b', glowSize: 6,
    },
    text: { fontFamily: 'serif', color: '#17395c', size: 18, haloColor: '#fff5d8', haloWidth: 2.2, backgroundColor: '#ead7ac', backgroundRounded: false },
    legend: { backgroundColor: '#ead7ac', backgroundOpacity: 99, textColor: '#17395c', fontFamily: 'serif', glowEnabled: false },
    controls: { backgroundColor: '#ead7ac', backgroundOpacity: 99, iconColor: '#17395c', accentColor: '#b52e2b', activeTextColor: '#fff5d8', borderColor: '#17395c', borderOpacity: 100, borderWidth: 4, borderRadius: 2, glowEnabled: false },
  },

  'three-d': {
    feature: {
      color: '#ff3cac', opacity: 100, pointSize: 10, lineWidth: 5,
      fillColor: '#784ba0', fillOpacity: 42,
      borderColor: '#2bfff1', borderOpacity: 100,
      pointBorderWidth: 4, lineBorderWidth: 3, polygonBorderWidth: 4,
      glowEnabled: true, glowColor: '#ff3cac', glowSize: 24, glowOpacity: 74,
    },
    popup: {
      backgroundColor: '#1a1029', backgroundOpacity: 88, textColor: '#fff4ff',
      borderColor: '#2bfff1', borderOpacity: 100, borderWidth: 2,
      borderRadius: 24, maxWidth: 500, glowEnabled: true, glowColor: '#ff3cac', glowSize: 32,
    },
    text: { color: '#2bfff1', size: 18, haloColor: '#1a1029', haloWidth: 2.8, backgroundColor: '#28163d' },
    legend: { backgroundColor: '#1a1029', backgroundOpacity: 86, textColor: '#fff4ff', glowEnabled: true, glowColor: '#ff3cac', glowSize: 30 },
    controls: { backgroundColor: '#1a1029', backgroundOpacity: 88, iconColor: '#2bfff1', accentColor: '#ff3cac', activeTextColor: '#ffffff', borderColor: '#2bfff1', borderOpacity: 100, borderWidth: 2, borderRadius: 30, glowEnabled: true, glowColor: '#ff3cac', glowSize: 28 },
  },
};

export function getBasemapStyleDefaults(basemapId = 'positron') {
  const theme = THEMES[basemapId] ?? THEMES.positron;
  const popup = { ...COMMON.popup, ...theme.popup };
  return {
    feature: { ...COMMON.feature, ...theme.feature },
    popup,
    text: { ...COMMON.text, ...theme.text },
    legend: {
      ...COMMON.legend,
      borderColor: popup.borderColor,
      borderOpacity: popup.borderOpacity,
      borderWidth: popup.borderWidth,
      borderRadius: popup.borderRadius,
      ...theme.legend,
    },
    controls: { ...COMMON.controls, ...theme.controls },
  };
}

export const DEFAULT_BASEMAP_ID = 'positron';
export const DEFAULT_STYLE = getBasemapStyleDefaults(DEFAULT_BASEMAP_ID);
