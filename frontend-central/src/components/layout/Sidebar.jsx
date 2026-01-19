import React from 'react';
import { useUI } from "../../context/UIContext";

const Sidebar = ({ isCentral, activeTab, setActiveTab, user }) => {
  const { modals, closeModal } = useUI();
  
  if (!isCentral || !modals.sidebar) return null;

  return (
    <>
      <div className="offcanvas offcanvas-start bg-dark text-white show" tabIndex={-1}>
        <div className="offcanvas-header border-bottom border-secondary">
          <h5 className="offcanvas-title">Menu</h5>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={() => closeModal('sidebar')}
          ></button>
        </div>
        <div className="offcanvas-body">
          <ul className="nav nav-pills flex-column gap-2">
            <li className="nav-item">
              <button
                className={`nav-link w-100 text-start ${
                  activeTab === "camera-rtsp" ? "active bg-primary" : "text-white-50"
                }`}
                onClick={() => {
                  setActiveTab("camera-rtsp");
                  closeModal('sidebar');
                }}
              >
                <i className="bi bi-camera-video me-2"></i>Camera RTSP
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link w-100 text-start ${
                  activeTab === "recording" ? "active bg-primary" : "text-white-50"
                }`}
                onClick={() => {
                  setActiveTab("recording");
                  closeModal('sidebar');
                }}
              >
                <i className="bi bi-record-circle me-2 text-danger"></i>Recording
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link w-100 text-start ${
                  activeTab === "timelapse" ? "active bg-primary" : "text-white-50"
                }`}
                onClick={() => {
                  setActiveTab("timelapse");
                  closeModal('sidebar');
                }}
              >
                <i className="bi bi-clock-history me-2"></i>Timelapse
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link w-100 text-start ${
                  activeTab === "parking" ? "active bg-primary" : "text-white-50"
                }`}
                onClick={() => {
                  setActiveTab("parking");
                  closeModal('sidebar');
                }}
              >
                <i className="bi bi-lock me-2"></i>Parking Locker
              </button>
            </li>
            {['admin', 'manager'].includes(user?.role) && (
              <li className="nav-item">
                <button
                  className={`nav-link w-100 text-start ${
                    activeTab === "shift-history" ? "active bg-primary" : "text-white-50"
                  }`}
                  onClick={() => {
                    setActiveTab("shift-history");
                    closeModal('sidebar');
                  }}
                >
                  <i className="bi bi-clock-history me-2"></i>Lịch sử Ca trực
                </button>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div
        className="offcanvas-backdrop fade show"
        onClick={() => closeModal('sidebar')}
      ></div>
    </>
  );
};

export default Sidebar;
