import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const ACTIONS = [
  { type: 'select', label: 'Select', icon: '↖' },
  { type: 'point', label: 'Point', icon: '●' },
  { type: 'line', label: 'Line', icon: '╱' },
  { type: 'polygon', label: 'Polygon', icon: '⬡' },
  { type: 'circle', label: 'Circle', icon: '○' },
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'quick-route', label: 'Quick route', icon: '⤳', divider: true },
  { type: 'water-route', label: 'Water autoroute', icon: '≈' },
  { type: 'land-route', label: 'Walking route', icon: '⇢' },
];

export default function DrawingContextMenu({ activeLayerName, position, onChoose, onClose }) {
  const menuRef = useRef(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const bounds = menu.getBoundingClientRect();
    setAdjustedPosition({
      x: Math.max(margin, Math.min(position.x, window.innerWidth - bounds.width - margin)),
      y: Math.max(margin, Math.min(position.y, window.innerHeight - bounds.height - margin)),
    });
  }, [position]);

  useEffect(() => {
    const closeOnPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) onClose();
    };
    const closeOnKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const closeOnViewportChange = () => onClose();
    document.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('blur', closeOnViewportChange);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('blur', closeOnViewportChange);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="drawing-context-menu"
      role="menu"
      aria-label="Drawing tools"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <div className="drawing-context-heading">
        <strong>Drawing tools</strong>
        <span>{activeLayerName || 'No active layer'}</span>
      </div>
      {ACTIONS.map((action) => (
        <button
          className={action.divider ? 'has-divider' : ''}
          key={action.type}
          type="button"
          role="menuitem"
          onClick={() => onChoose(action.type)}
        >
          <span aria-hidden="true">{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
