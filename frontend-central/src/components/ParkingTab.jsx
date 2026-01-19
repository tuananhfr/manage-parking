import { useState } from "react";
import ParkingOverview from "./parking/ParkingOverview";
import CommandLogs from "./parking/CommandLogs";
import PaymentHistory from "./parking/PaymentHistory";
import ParkingSettings from "./parking/ParkingSettings";

const ParkingTab = ({ showManageBackends, onCloseManageBackends }) => {
  const [activeTab, setActiveTab] = useState("overview");

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return <ParkingOverview showManageBackends={showManageBackends} onCloseManageBackends={onCloseManageBackends} />;
      case "logs":
        return <CommandLogs />;
      case "payment":
        return <PaymentHistory />;
      case "settings":
        return <ParkingSettings />;
      default:
        return <ParkingOverview showManageBackends={showManageBackends} onCloseManageBackends={onCloseManageBackends} />;
    }
  };

  return (
    <div className="d-flex flex-column h-100">
      {/* Tab Navigation */}
      <div className="bg-dark border-bottom border-secondary px-4 pt-3">
        <ul className="nav nav-tabs border-bottom-0">
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === "overview" ? "active bg-dark text-white border-secondary border-bottom-0" : "text-secondary border-0"}`}
              onClick={() => setActiveTab("overview")}
            >
              <i className="bi bi-grid-fill me-2"></i>
              Tổng quan
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === "logs" ? "active bg-dark text-white border-secondary border-bottom-0" : "text-secondary border-0"}`}
              onClick={() => setActiveTab("logs")}
            >
              <i className="bi bi-journal-text me-2"></i>
              Nhật ký lệnh
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === "payment" ? "active bg-dark text-white border-secondary border-bottom-0" : "text-secondary border-0"}`}
              onClick={() => setActiveTab("payment")}
            >
              <i className="bi bi-wallet2 me-2"></i>
              Lịch sử thanh toán
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === "settings" ? "active bg-dark text-white border-secondary border-bottom-0" : "text-secondary border-0"}`}
              onClick={() => setActiveTab("settings")}
            >
              <i className="bi bi-gear-fill me-2"></i>
              Cài đặt
            </button>
          </li>
        </ul>
      </div>

      {/* Tab Content */}
      <div className="flex-grow-1 bg-dark text-white overflow-hidden">
        <div className="h-100 p-3 pt-4" style={{ overflowY: "auto" }}>
            {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default ParkingTab;
