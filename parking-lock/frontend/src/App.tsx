import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import socketService from "./services/socket";
import Dashboard from "./pages/Dashboard";
import LockerList from "./pages/LockerList";
import DeviceManagement from "./pages/DeviceManagement";
import CommandLogs from "./pages/CommandLogs";
import StatusLogs from "./pages/StatusLogs";
import StatusBoard from "./pages/StatusBoard";
import Settings from "./pages/Settings";
import PaymentHistory from "./pages/PaymentHistory";
import "./styles/app-layout.css";

interface NavItem {
  path: string;
  icon: string;
  label: string;
  badge?: string;
}

const navigationItems: NavItem[] = [
  { path: "/", icon: "bi-grid-fill", label: "Dashboard" },
  { path: "/lockers", icon: "bi-lock-fill", label: "Lockers" },
  { path: "/devices", icon: "bi-cpu-fill", label: "Devices" },
  { path: "/payment-history", icon: "bi-receipt", label: "Payments" },
  { path: "/status-board", icon: "bi-tv-fill", label: "Status Board" },
  { path: "/logs/commands", icon: "bi-terminal-fill", label: "Commands" },
  { path: "/logs/status", icon: "bi-list-check", label: "Status Logs" },
  { path: "/settings", icon: "bi-gear-fill", label: "Settings" },
];

function NavBar() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === "/") {
      return location.pathname === "/";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="app-navbar">
      <div className="navbar-container">
        {/* Logo & Brand */}
        <Link to="/" className="navbar-brand">
          <div className="brand-icon">
            <i className="bi bi-shield-lock-fill"></i>
          </div>
          <div className="brand-text">
            <span className="brand-name">Parking Lock</span>
            <span className="brand-subtitle">Management System</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <div className="navbar-menu">
          {navigationItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive(item.path) ? "active" : ""}`}
            >
              <i className={`bi ${item.icon}`}></i>
              <span>{item.label}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </Link>
          ))}
        </div>

        {/* System Status Indicator */}
        <div className="navbar-actions">
          <div className="system-status">
            <div className="status-dot online"></div>
            <span className="status-text">System Online</span>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <i className={`bi ${isMobileMenuOpen ? "bi-x-lg" : "bi-list"}`}></i>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="mobile-menu">
          {navigationItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`mobile-nav-item ${isActive(item.path) ? "active" : ""}`}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <i className={`bi ${item.icon}`}></i>
              <span>{item.label}</span>
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

function App() {
  useEffect(() => {
    // Connect to WebSocket on app mount
    socketService.connect();

    return () => {
      socketService.disconnect();
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app-container">
        <NavBar />

        <main className="app-main">
          <div className="app-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/lockers" element={<LockerList />} />
              <Route path="/devices" element={<DeviceManagement />} />
              <Route path="/logs/commands" element={<CommandLogs />} />
              <Route path="/logs/status" element={<StatusLogs />} />
              <Route path="/status-board" element={<StatusBoard />} />
              <Route path="/payment-history" element={<PaymentHistory />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
