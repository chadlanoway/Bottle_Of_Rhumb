import { useEffect, useState } from 'react';

export default function StatusNotice({ message, className, setStatus, duration = 6000, children }) {
  const [fading, setFading] = useState(false);
  const dismiss = () => setStatus(current => current === message ? '' : current);

  useEffect(() => {
    if (!duration) return;
    const fade = window.setTimeout(() => setFading(true), duration);
    const close = window.setTimeout(() => {
      setStatus(current => current === message ? '' : current);
    }, duration + 250);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(close);
    };
  }, [duration, message, setStatus]);

  return (
    <div className={`${className} status-notice${fading ? ' is-fading' : ''}`}>
      <span className="status-notice-message" role="status">{children}{message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={dismiss}>×</button>
    </div>
  );
}
