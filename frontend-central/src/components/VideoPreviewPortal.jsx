import React, { useState } from 'react';
import { createPortal } from 'react-dom';

const VideoPreviewPortal = ({ url, rect }) => {
  const [hasError, setHasError] = useState(false);
  const style = React.useMemo(() => {
    if (!rect) return {};

    const PREVIEW_WIDTH = 320;
    const PREVIEW_HEIGHT = 240;
    const GAP = 10;

    let left = rect.right + GAP;
    let top = rect.top;

    if (top + PREVIEW_HEIGHT > window.innerHeight - 20) {
      top = Math.max(10, rect.bottom - PREVIEW_HEIGHT);
    }

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${PREVIEW_WIDTH}px`,
      height: `${PREVIEW_HEIGHT}px`,
      zIndex: 9999,
      background: '#000',
      border: '2px solid #0d6efd',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
  }, [rect]);

  return createPortal(
    <div style={style}>
        {hasError ? (
            <div style={{color: '#666', fontSize: '0.8rem'}}>Không thể xem trước</div>
        ) : (
            <video
                src={url}
                muted
                autoPlay
                loop
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={() => setHasError(true)}
            />
        )}
    </div>,
    document.body
  );
};

export default VideoPreviewPortal;
