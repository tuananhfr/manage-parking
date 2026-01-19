import { useEffect, useState, useRef } from 'react';



const VideoPlayer = ({ camera }) => {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const streamSetRef = useRef(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

  useEffect(() => {
    let pc = null;
    let isCleanedUp = false;

    const startStream = async () => {
      try {
        setLoading(true);
        setError('');
        streamSetRef.current = false;

        if (!camera.nvr_id) {
            throw new Error('Missing NVR ID for camera');
        }

        // Create WebRTC peer connection
        pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        // Handle incoming tracks
        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0] && !streamSetRef.current) {
            streamSetRef.current = true;
            const video = videoRef.current;
            video.srcObject = event.streams[0];
            video.setAttribute('playsinline', 'true');

            const tryPlay = () => {
              video.play()
                .then(() => {
                    if (!isCleanedUp) setLoading(false);
                })
                .catch(() => {
                    if (!isCleanedUp) setLoading(false);
                });
            };

            video.onloadedmetadata = () => tryPlay();
            if (video.readyState >= 1) tryPlay();

            video.onerror = () => {
              if (!isCleanedUp) {
                  setError(`Video error: ${video.error?.message || 'Unknown'}`);
                  setLoading(false);
              }
            };

            video.onplaying = () => {
                if (!isCleanedUp) setLoading(false);
            };
          }
        };

        // Monitor ICE connection state
        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            if (!isCleanedUp) {
                setError(`Connection ${pc.iceConnectionState}`);
                setLoading(false);
            }
          }
        };

        // Add transceiver for receiving video
        pc.addTransceiver('video', { direction: 'recvonly' });
        if (camera.hasAudio !== false) {
          pc.addTransceiver('audio', { direction: 'recvonly' });
        }

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // WebRTC Exchange via Backend Proxy
        try {
            const response = await fetch(`${BACKEND_URL}/api/webrtc/nvr/${camera.nvr_id}/${camera.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'offer',
                    sdp: offer.sdp
                })
            });

            if (!response.ok) {
                throw new Error(`WebRTC negotiation failed: ${response.status}`);
            }

            const answer = await response.json();
            if (answer.type === 'answer') {
                await pc.setRemoteDescription({
                    type: 'answer',
                    sdp: answer.value || answer.sdp // go2rtc might return value or sdp field? check backend logic
                });
            } else {
                 // Might be error object
                 throw new Error(answer.error || 'Invalid WebRTC answer');
            }

        } catch (err) {
            console.error(err);
             if (!isCleanedUp) {
                setError(err.message || 'Stream negotiation failed');
                setLoading(false);
            }
        }

      } catch (err) {
        if (!isCleanedUp) {
            setError(err instanceof Error ? err.message : 'Failed to start stream');
            setLoading(false);
        }
      }
    };

    startStream();

    const videoEl = videoRef.current;

    return () => {
      isCleanedUp = true;
      streamSetRef.current = false;
      if (pc) {
        pc.close();
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, [camera.url, camera.hasAudio, camera.id, camera.nvr_id, BACKEND_URL]);

  return (
    <div className="position-relative bg-black" style={{ aspectRatio: '16/9' }}>
      {loading && (
        <div className="position-absolute top-50 start-50 translate-middle">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="position-absolute top-50 start-50 translate-middle w-75">
          <div className="alert alert-danger mb-0 text-center" role="alert">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-100 h-100"
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
};

export default VideoPlayer;
