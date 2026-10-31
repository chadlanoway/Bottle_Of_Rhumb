import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const ACTIONS = [
  { type: 'select', label: 'Select', icon: '↖', help: 'Select, move, and edit existing features.' },
  { type: 'point', label: 'Point', icon: '●', help: 'Place a point on the map.' },
  { type: 'line', label: 'Line', icon: '╱', help: 'Draw a line one vertex at a time.' },
  { type: 'polygon', label: 'Polygon', icon: '⬡', help: 'Draw an enclosed area on the map.' },
  { type: 'circle', label: 'Circle', icon: '○', help: 'Draw a circle from its center and radius.' },
  { type: 'text', label: 'Text', icon: 'T', help: 'Place editable text on the map.' },
  { type: 'my-location', label: 'My location', icon: '◎', help: "Place a point on the map at your device's location." },
  { type: 'quick-route', label: 'Quick route', icon: '⤳', divider: true, help: 'Place two points, then adjust the automatic line connecting them.' },
  { type: 'water-route', label: 'Water autoroute', icon: '≈', help: 'Create an editable water route that avoids land.' },
  { type: 'land-route', label: 'Walking route', icon: '⇢', help: 'Place two points to create a walking route.' },
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
          title={action.help}
          aria-label={`${action.label}. ${action.help}`}
          onClick={() => onChoose(action.type)}
        >
          <span aria-hidden="true">{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
