import { useState, useEffect } from "react";
import useCameras from "./hooks/useCameras";
import useStats from "./hooks/useStats";
import useStaff from "./hooks/useStaff";
import useSubscriptions from "./hooks/useSubscriptions";
import useBackendType from "./hooks/useBackendType";
import useConnectionStatus from "./hooks/useConnectionStatus";
import Layout from "./components/layout/Layout";
import CameraRTSPTab from "./components/CameraRTSPTab";
import TimelapseTab from "./components/TimelapseTab";
import ParkingTab from "./components/ParkingTab";
import RecordingTab from "./components/RecordingTab";
import UserProfileModal from "./components/profile/UserProfileModal";
import HandoverModal from "./components/profile/HandoverModal";
import HistoryModal from "./components/layout/header/HistoryModal";
import StaffModal from "./components/layout/header/StaffModal";
import SubscriptionModal from "./components/layout/header/SubscriptionModal";
import SettingsModal from "./components/settings/SettingsModal";
import TimelapseSettingsModal from "./components/TimelapseSettingsModal";
import AdminShiftHistory from "./pages/AdminShiftHistory";
import Sidebar from "./components/layout/Sidebar";
import TopNavbar from "./components/layout/TopNavbar";
import { UIProvider, useUI } from "./context/UIContext";

function MainAppContent({ user, onLogout }) {
  const { isEdge, isCentral } = useBackendType();
  useConnectionStatus();
  const { modals, closeModal, openModal } = useUI();
  const [activeTab, setActiveTab] = useState("camera-rtsp"); // Default tab cho Central mode

  // Khi là Edge, force tab mặc định là camera-ai và không cho đổi
  useEffect(() => {
    if (isEdge) {
      setActiveTab("camera-ai");
    } else if (isCentral) {
      // Khi là Central, set tab mặc định là camera-rtsp
      setActiveTab("camera-rtsp");
    }
  }, [isEdge, isCentral]);
  
  const [historyKey, setHistoryKey] = useState(0);
  const [timelapseConfig, setTimelapseConfig] = useState(null);

  const { cameras, fetchCameras } = useCameras();
  const { stats } = useStats();
  const { staff, fetchStaff } = useStaff();
  const { subscriptions, fetchSubscriptions } = useSubscriptions();

  const handleHistoryUpdate = () => {
    setHistoryKey((prev) => prev + 1);
  };

  const handleLogoutClick = () => {
    closeModal('profile');
    openModal('handover');
  };

  const loadTimelapseConfig = async () => {
    const BACKEND_URL =
      import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
    try {
      const response = await fetch(`${BACKEND_URL}/api/timelapse/config`);
      if (!response.ok) throw new Error("Failed to fetch config");
      const result = await response.json();
      const config = result.data || result;
      setTimelapseConfig(config);
    } catch (error) {
      console.error("Error loading timelapse config:", error);
    }
  };

  useEffect(() => {
    if (modals.timelapseSettings) {
      loadTimelapseConfig();
    }
  }, [modals.timelapseSettings]);

  return (
    <div
      className="d-flex h-100 bg-dark app-container"
      style={{ height: "100vh", overflow: "hidden", width: "100vw" }}
    >
      <Sidebar 
          isCentral={isCentral}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          user={user}
      />

      <div className="d-flex flex-column flex-grow-1" style={{ minWidth: 0 }}>
        
        <TopNavbar 
             isCentral={isCentral}
             user={user}
             stats={stats}
             activeTab={activeTab}
        />

        <div
          className="flex-grow-1 d-flex flex-column overflow-hidden"
          style={{ minHeight: 0 }}
        >
          {/* Khi là Edge, chỉ hiển thị Camera AI */}
          {isEdge ? (
            <Layout
              cameras={cameras}
              onHistoryUpdate={handleHistoryUpdate}
              onFetchCameras={fetchCameras}
            />
          ) : (
            <>
              {activeTab === "camera-rtsp" ? (
                <CameraRTSPTab
                  showAddModal={modals.addCamera}
                  onCloseAddModal={() => closeModal('addCamera')}
                  user={user}
                />
              ) : activeTab === "timelapse" ? (
                <TimelapseTab
                  showSettings={modals.timelapseSettings}
                  onCloseSettings={() => closeModal('timelapseSettings')}
                  user={user}
                />
              ) : activeTab === "parking" ? (
                <ParkingTab
                  showManageBackends={modals.manageBackends}
                  onCloseManageBackends={() => closeModal('manageBackends')}
                />
              ) : activeTab === "recording" ? (
                <RecordingTab user={user} />
              ) : activeTab === "camera-ai" ? (
                <Layout
                  cameras={cameras}
                  onHistoryUpdate={handleHistoryUpdate}
                  onFetchCameras={fetchCameras}
                />
              ) : activeTab === "shift-history" ? (
                <AdminShiftHistory />
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Global Modals - Available on all tabs */}
      <HistoryModal
        show={modals.history}
        onClose={() => closeModal('history')}
        historyKey={historyKey}
        user={user}
      />

      {modals.staff && (
        <StaffModal
          show={modals.staff}
          staff={staff}
          onFetchStaff={fetchStaff}
          onClose={() => closeModal('staff')}
        />
      )}

      {modals.subscription && (
        <SubscriptionModal
          show={modals.subscription}
          subscriptions={subscriptions}
          onFetchSubscriptions={fetchSubscriptions}
          onClose={() => closeModal('subscription')}
        />
      )}

      <SettingsModal
        show={modals.settings}
        onClose={() => closeModal('settings')}
        onSaveSuccess={fetchCameras}
      />

      {/* User Profile Modal */}
      <UserProfileModal
        show={modals.profile}
        onClose={() => closeModal('profile')}
        onLogout={handleLogoutClick}
        user={user}
      />

      <HandoverModal
        show={modals.handover}
        onClose={() => closeModal('handover')}
        onConfirmLogout={onLogout}
      />

      <TimelapseSettingsModal
        show={modals.timelapseSettings}
        onClose={() => closeModal('timelapseSettings')}
        timelapseConfig={timelapseConfig}
        onSave={(updatedConfig) => {
          setTimelapseConfig(updatedConfig);
        }}
      />
    </div>
  );
}

function MainApp(props) {
  return (
    <UIProvider>
      <MainAppContent {...props} />
    </UIProvider>
  );
}

export default MainApp;
