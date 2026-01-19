import React from 'react';
import dayjs from "dayjs";
import ConnectionStatus from "../connection/ConnectionStatus";
import { useUI } from "../../context/UIContext";

const TopNavbar = ({
    isCentral,
    user,
    stats,
    activeTab,
}) => {
    const { toggleModal, openModal } = useUI();

    return (
        <nav
            className="navbar navbar-dark bg-black border-bottom border-secondary flex-shrink-0 position-relative"
            style={{ minHeight: "56px" }}
        >
            <div
                style={{
                    width: "100%",
                    padding: "0 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                }}
            >
                {/* Menu button - chỉ hiển thị khi là Central */}
                {isCentral && (
                    <button
                        className="btn btn-outline-light"
                        onClick={() => toggleModal('sidebar')}
                    >
                        <i className="bi bi-list"></i>
                    </button>
                )}

                {/* Connection Status Indicator */}
                <ConnectionStatus />

                {/* Date Display */}
                <div className="text-white-50 border-start border-secondary ps-3" style={{ fontSize: "0.9rem" }}>
                    <i className="bi bi-calendar3 me-2"></i>
                    {dayjs().format("DD/MM/YYYY")}
                </div>

                {/* Stats - Left aligned next to menu button */}
                <div className="stats-container-left">
                    <div className="d-flex text-white">
                        <div className="stats-item text-center">
                            <div className="fw-bold" style={{ fontSize: "1rem", lineHeight: "1.2" }}>
                                {stats?.entries_today || 0}
                            </div>
                            <div className="text-white-50" style={{ fontSize: "0.7rem", lineHeight: "1" }}>
                                VÀO
                            </div>
                        </div>
                        <div className="stats-item text-center position-relative">
                            <div className="position-absolute start-0 top-0 bottom-0" style={{ width: "1px", backgroundColor: "rgba(255, 255, 255, 0.25)" }}></div>
                            <div className="fw-bold" style={{ fontSize: "1rem", lineHeight: "1.2" }}>
                                {stats?.exits_today || 0}
                            </div>
                            <div className="text-white-50" style={{ fontSize: "0.7rem", lineHeight: "1" }}>
                                RA
                            </div>
                        </div>
                        <div className="stats-item text-center position-relative">
                            <div className="position-absolute start-0 top-0 bottom-0" style={{ width: "1px", backgroundColor: "rgba(255, 255, 255, 0.25)" }}></div>
                            <div className="fw-bold" style={{ fontSize: "1rem", lineHeight: "1.2" }}>
                                {stats?.vehicles_in_parking || 0}
                            </div>
                            <div className="text-white-50" style={{ fontSize: "0.7rem", lineHeight: "1" }}>
                                Trong bãi
                            </div>
                        </div>
                        <div className="stats-item text-center position-relative">
                            <div className="position-absolute start-0 top-0 bottom-0" style={{ width: "1px", backgroundColor: "rgba(255, 255, 255, 0.25)" }}></div>
                            <div className="fw-bold" style={{ fontSize: "1rem", lineHeight: "1.2" }}>
                                {((stats?.revenue_today || 0) / 1000).toFixed(0)}K
                            </div>
                            <div className="text-white-50" style={{ fontSize: "0.7rem", lineHeight: "1" }}>
                                Thu
                            </div>
                        </div>
                    </div>
                </div>

                {/* Buttons */}
                <div className="d-flex gap-2" style={{ marginLeft: "auto", flexShrink: 0 }}>
                    {/* Tab-specific buttons - chỉ hiển thị khi là Central */}
                    {isCentral && (
                        <>
                            {activeTab === "camera-rtsp" && user?.role === "manager" && (
                                <button className="btn btn-sm btn-primary" onClick={() => openModal('addCamera')}>
                                    <i className="bi bi-plus-circle me-2"></i>Add Camera
                                </button>
                            )}
                            {activeTab === "timelapse" && (
                                <button className="btn btn-sm btn-outline-light" onClick={() => openModal('timelapseSettings')}>
                                    <i className="bi bi-gear me-2"></i>Cài đặt timelapse
                                </button>
                            )}
                            {activeTab === "parking" && (
                                <button className="btn btn-sm btn-primary" onClick={() => openModal('manageBackends')}>
                                    <i className="bi bi-plus-circle me-2"></i>Thêm bãi đỗ xe
                                </button>
                            )}
                        </>
                    )}

                    {/* Common buttons - always visible */}
                    <button className="btn btn-sm btn-outline-light" onClick={() => openModal('history')}>
                        <i className="bi bi-clock-history me-1"></i>Xem lịch sử
                    </button>
                    <button className="btn btn-sm btn-outline-light" onClick={() => toggleModal('staff')}>
                        <i className="bi bi-people-fill me-1"></i>Người trực
                    </button>
                    <button className="btn btn-sm btn-outline-light" onClick={() => openModal('subscription')}>
                        <i className="bi bi-card-list me-1"></i>Thuê bao
                    </button>
                    {/* Settings button - Manager only */}
                    {user?.role === 'manager' && (
                        <button className="btn btn-sm btn-outline-light" onClick={() => openModal('settings')}>
                            <i className="bi bi-gear-fill me-1"></i>Cài đặt
                        </button>
                    )}
                    {/* Profile/Logout button */}
                    <button
                        className="btn btn-sm btn-outline-secondary text-light"
                        onClick={() => openModal('profile')}
                        title={`Tài khoản: ${user?.username}`}
                    >
                        <i className="bi bi-person-circle me-1"></i>
                        {user?.full_name || user?.username}
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default TopNavbar;
