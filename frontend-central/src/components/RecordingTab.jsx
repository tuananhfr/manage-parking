import React, { useEffect, useMemo, useState } from "react";
import VideoPreviewPortal from "./VideoPreviewPortal";
import useRecordings from "../hooks/useRecordings";
import RecordingFilters from "./recording/RecordingFilters";
import RecordingTable from "./recording/RecordingTable";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const RecordingTab = () => {
    // === Camera & NVR State (Ideally this should also be a hook or from context) ===
    const [cameras, setCameras] = useState([]);
    const [loadingCameras, setLoadingCameras] = useState(true);
    const [selectedNvrId, setSelectedNvrId] = useState("");
    const [selectedCameraId, setSelectedCameraId] = useState("");
    const [cameraError, setCameraError] = useState("");

    // === UI State ===
    const [selectedVideo, setSelectedVideo] = useState(null); // { url, filename }
    const [hoveredRecording, setHoveredRecording] = useState(null); // { url, rect }

    // === Load Cameras ===
    useEffect(() => {
        const loadCameras = async () => {
            try {
                setLoadingCameras(true);
                setCameraError("");
                const resp = await fetch(`${BACKEND_URL}/api/rtsp-cameras`);
                if (!resp.ok) throw new Error(`Failed to fetch cameras: ${resp.status}`);
                const data = await resp.json();
                const list = Array.isArray(data) ? data : [];
                setCameras(list);
                if (list.length > 0) {
                    const first = list[0];
                    setSelectedNvrId(first.nvr_id || "");
                    setSelectedCameraId(first.id || "");
                }
            } catch (e) {
                console.error("[RecordingTab] Failed to load cameras", e);
                setCameraError(e instanceof Error ? e.message : "Failed to load cameras");
            } finally {
                setLoadingCameras(false);
            }
        };
        loadCameras();
    }, []);

    const nvrOptions = useMemo(() => {
        const map = new Map();
        cameras.forEach((c) => {
            if (c.nvr_id) {
                map.set(c.nvr_id, c.nvr_name || c.nvr_id);
            }
        });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [cameras]);

    const cameraOptions = useMemo(() => {
        return cameras.filter((c) => !selectedNvrId || c.nvr_id === selectedNvrId);
    }, [cameras, selectedNvrId]);

    // === Recordings Logic using Custom Hook ===
    // Note: We deliberately don't pass filtered list to table if we want to show loading states correctly handled by hook
    const {
        recordings,
        loading,
        loadingMore,
        error: recordingError,
        hasMore,
        totalRecordings,
        filters,
        setFilters,
        loadRecordings,
        loadMoreRecordings
    } = useRecordings(selectedNvrId, selectedCameraId);

    const handleDownload = (url, filename) => {
        const link = document.createElement("a");
        link.href = `${url}&download=true`;
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="h-100 w-100 d-flex flex-column bg-dark text-white" style={{ minHeight: 0, overflow: "hidden" }}>
            <div className="border-bottom border-secondary px-3 py-2 d-flex align-items-center justify-content-between">
                <div>
                    <h5 className="mb-0">
                        <i className="bi bi-record-circle me-2 text-danger"></i>Recording
                    </h5>
                    <small className="text-secondary">Xem danh sách file ghi hình từ các NVR.</small>
                </div>
            </div>

            <div className="flex-grow-1 d-flex flex-column px-3 py-2" style={{ minHeight: 0 }}>
                <RecordingFilters
                    nvrOptions={nvrOptions}
                    selectedNvrId={selectedNvrId}
                    setSelectedNvrId={setSelectedNvrId}
                    cameraOptions={cameraOptions}
                    selectedCameraId={selectedCameraId}
                    setSelectedCameraId={setSelectedCameraId}
                    filters={filters}
                    setFilters={setFilters}
                    loading={loading}
                    onReload={() => loadRecordings(1, false)}
                    loadingCameras={loadingCameras}
                />

                {/* Filter Summary */}
                {/* Note: In the new hook, 'recordings' is already filtered if using client side, 
                    OR it is the list returned from server. 
                    The comparison (filtered vs total) logic from original code is a bit ambiguous if server does filtering.
                    We will omit it for now or implement if 'totalRecordings' > recordings.length
                */}

                {/* Errors */}
                {(cameraError || recordingError) && (
                    <div className="alert alert-danger py-1 px-2 mb-2" style={{ fontSize: "0.8rem" }}>
                        <i className="bi bi-exclamation-triangle me-2"></i>
                        {cameraError || recordingError}
                    </div>
                )}

                <RecordingTable
                    recordings={recordings}
                    loading={loading}
                    loadingCameras={loadingCameras}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    totalRecordings={totalRecordings}
                    onLoadMore={loadMoreRecordings}
                    onPlay={setSelectedVideo}
                    onDownload={handleDownload}
                    onHover={setHoveredRecording}
                    onLeave={() => setHoveredRecording(null)}
                    backendUrl={BACKEND_URL}
                    selectedNvrId={selectedNvrId}
                />
            </div>

            {/* Video Modal */}
            {selectedVideo && (
                <div className="modal show d-block" style={{ backgroundColor: "rgba(0,0,0,0.8)" }} onClick={() => setSelectedVideo(null)}>
                    <div className="modal-dialog modal-lg modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-content bg-dark text-white">
                            <div className="modal-header border-secondary">
                                <h5 className="modal-title">
                                    <i className="bi bi-play-circle me-2"></i>{selectedVideo.filename}
                                </h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setSelectedVideo(null)}></button>
                            </div>
                            <div className="modal-body p-0">
                                <video
                                    controls
                                    controlsList="nodownload"
                                    onContextMenu={(e) => e.preventDefault()}
                                    autoPlay
                                    style={{ width: "100%", maxHeight: "70vh" }}
                                    src={selectedVideo.url}
                                >
                                    Trình duyệt của bạn không hỗ trợ video tag.
                                </video>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Video Preview Portal */}
            {hoveredRecording && (
                <VideoPreviewPortal
                    url={hoveredRecording.url}
                    rect={hoveredRecording.rect}
                />
            )}
        </div>
    );
};

export default RecordingTab;
