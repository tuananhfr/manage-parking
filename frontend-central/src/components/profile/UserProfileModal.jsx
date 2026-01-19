import React from "react";

const UserProfileModal = ({ show, onClose, onLogout, user }) => {
  if (!show) return null;

  return (
    <>
      <div
        className="modal show d-block"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      >
        <div
          className="modal-dialog modal-dialog-centered"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-content bg-dark text-white border-secondary">
            <div className="modal-header border-secondary">
              <h5 className="modal-title">
                <i className="bi bi-person-circle me-2"></i>
                Thông tin tài khoản
              </h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
              ></button>
            </div>
            <div className="modal-body text-center py-4">
              <div className="mb-3">
                <div
                  className="rounded-circle bg-secondary d-inline-flex align-items-center justify-content-center"
                  style={{ width: "80px", height: "80px" }}
                >
                  <i className="bi bi-person-fill display-4 text-white"></i>
                </div>
              </div>

              <h4 className="mb-1">{user?.full_name || "Unknown User"}</h4>
              <p className="text-secondary mb-3">@{user?.username}</p>

              <div className="d-flex justify-content-center gap-2 mb-3">
                <span
                  className={`badge ${
                    user?.role === "manager" ? "bg-danger" : "bg-primary"
                  }`}
                >
                  {user?.role === "manager"
                    ? "Quản lý"
                    : user?.role === "guard"
                    ? "Bảo vệ"
                    : user?.role}
                </span>
                <span className="badge bg-success">Active</span>
              </div>
            </div>
            <div className="modal-footer border-secondary justify-content-between">
              <button
                type="button"
                className="btn btn-outline-light"
                onClick={onClose}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={onLogout}
              >
                <i className="bi bi-box-arrow-right me-2"></i>
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" style={{ opacity: 0.5 }}></div>
    </>
  );
};

export default UserProfileModal;
