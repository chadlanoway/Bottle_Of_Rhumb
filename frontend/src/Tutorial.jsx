import { useEffect, useRef, useState } from 'react';

const STEPS = [
  {
    title: 'Choose your view',
    body: 'Start by choosing the area your audience should see. This demo moves to the Lake Michigan sample area. Use Set view when the extent looks right.',
  },
  {
    title: 'Choose a basemap',
    body: 'Open the Map tab to choose a basemap and projection that support the story your map is telling.',
  },
  {
    title: 'Add a start and end point',
    body: 'Add locations manually with Drawing tools, search for a place, or choose a port or marina. Two sample harbor points have been added for this demo.',
  },
  {
    title: 'Configure popups and labels',
    body: 'Open the Feature Editor to add popup text, labels, photos, colors, transparency, and glow to the selected sample point.',
  },
  {
    title: 'Import or draw the route',
    body: 'Draw the route yourself or drag GeoJSON, KML, or GPX onto the map. A sample route has been added between the two locations.',
  },
  {
    title: 'Save and share',
    body: 'Review the opening view, then use the Share tab to save the map and create its public link or embed code.',
  },
];

export default function Tutorial({ step, onBack, onClose, onNext }) {
  const bubbleRef = useRef(null);
  const [arrow, setArrow] = useState(null);

  useEffect(() => {
    if (step !== 0 && step !== 1 && step !== 2 && step !== 3 && step !== 4) {
      setArrow(null);
      return undefined;
    }

    let animationFrame;
    let retryTimer;
    let observer;

    function positionArrow() {
      const bubble = bubbleRef.current;

      if (!bubble) {
        setArrow(null);
        retryTimer = window.setTimeout(positionArrow, 100);
        return;
      }

      const bubbleRect = bubble.getBoundingClientRect();

      if (step === 1) {
        setArrow({
          left: bubbleRect.left + Math.min(95, bubbleRect.width * 0.22) + 20,
          top: bubbleRect.bottom + 12 + 150,
          rotation: 90,
          marginLeft: -110,
        });

        observer?.disconnect();
        observer = new ResizeObserver(positionArrow);
        observer.observe(bubble);
        return;
      }

      if (step === 2) {
        setArrow({
          left: bubbleRect.left + Math.min(95, bubbleRect.width * 0.22) + 20 - 100,
          top: bubbleRect.bottom + 12 + 150 - 320,
          rotation: 90,
          marginLeft: -110,
        });

        observer?.disconnect();
        observer = new ResizeObserver(positionArrow);
        observer.observe(bubble);
        return;
      }


      if (step === 3) {
        const target = document.querySelector('.feature-editor-toggle');

        if (!target) {
          setArrow(null);
          retryTimer = window.setTimeout(positionArrow, 100);
          return;
        }

        setArrow({
          left: bubbleRect.left + bubbleRect.width / 2 - 28,
          top: bubbleRect.bottom + 135,
          rotation: 0,
          marginLeft: 0,
        });

        observer?.disconnect();
        observer = new ResizeObserver(positionArrow);
        observer.observe(bubble);
        observer.observe(target);
        return;
      }

      // Step 5: use step 3's arrow position, shifted 25px downward.
      if (step === 4) {
        setArrow({
          left: bubbleRect.left + Math.min(95, bubbleRect.width * 0.22) + 20 - 100,
          top: bubbleRect.bottom + 12 + 150 - 320 + 25,
          rotation: 90,
          marginLeft: -110,
        });

        observer?.disconnect();
        observer = new ResizeObserver(positionArrow);
        observer.observe(bubble);
        return;
      }

      const target = document.querySelector('.map-section .primary-map-button');

      if (!target) {
        setArrow(null);
        retryTimer = window.setTimeout(positionArrow, 100);
        return;
      }

      const targetRect = target.getBoundingClientRect();

      // Start just below the left side of the tutorial bubble.
      const left = bubbleRect.left + Math.min(95, bubbleRect.width * 0.22) + 20;
      const top = bubbleRect.bottom + 12;
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + targetRect.height / 2;

      const rotation = Math.atan2(targetY - top, targetX - left) * (180 / Math.PI) - 90 + 8;

      setArrow({ left, top, rotation, marginLeft: -110 });

      observer?.disconnect();
      observer = new ResizeObserver(positionArrow);
      observer.observe(bubble);
      observer.observe(target);
    }

    animationFrame = requestAnimationFrame(() => {
      requestAnimationFrame(positionArrow);
    });

    window.addEventListener('resize', positionArrow);
    window.addEventListener('scroll', positionArrow, true);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(retryTimer);
      observer?.disconnect();
      window.removeEventListener('resize', positionArrow);
      window.removeEventListener('scroll', positionArrow, true);
    };
  }, [step]);

  if (step === null || step === undefined) return null;
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <>
      <section ref={bubbleRef} className="tutorial-bubble" aria-label="Bottle of Rhumb guided tour" aria-live="polite">
        <button className="tutorial-close" type="button" aria-label="Close tutorial" onClick={onClose}>×</button>
        <span className="tutorial-progress">{step + 1} of {STEPS.length}</span>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="tutorial-actions">
          <button type="button" disabled={step === 0} onClick={onBack}>Back</button>
          <button className="tutorial-next" type="button" onClick={last ? onClose : onNext}>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </section>

      {arrow && (
        <div
          className="tutorial-step-arrow-anchor"
          style={{
            left: arrow.left,
            top: arrow.top,
            marginLeft: arrow.marginLeft,
            rotate: `${arrow.rotation}deg`,
          }}
          aria-hidden="true"
        >
          <img
            className="tutorial-step-arrow-image"
            src={`${import.meta.env.BASE_URL}icons/rhumb-tutorial-arrow.svg`}
            alt=""
          />
        </div>
      )}

      <style>{`
        .tutorial-step-arrow-anchor {
          position: fixed;
          z-index: 10030;
          width: 56px;
          height: 88px;
          pointer-events: none;
          transform-origin: 50% 50%;
        }

        .tutorial-step-arrow-image {
          display: block;
          width: 56px;
          height: auto;
          animation: tutorial-step-arrow-bob 800ms ease-in-out infinite alternate;
        }

        @keyframes tutorial-step-arrow-bob {
          from { translate: 0 -4px; }
          to { translate: 0 7px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tutorial-step-arrow-image { animation: none; }
        }
      `}</style>
    </>
  );
}
