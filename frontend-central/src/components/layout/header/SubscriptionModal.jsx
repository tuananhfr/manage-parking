import React, { useEffect, useRef } from "react";
import DynamicButton from "@/components/button/DynamicButton";

/**
 * SubscriptionModal - Modal hiển thị danh sách thuê bao
 * Triggered từ Header MainApp
 */
const SubscriptionModal = ({ show, onClose, subscriptions, onFetchSubscriptions }) => {
  const hasFetched = useRef(false);

  useEffect(() => {
    // Only fetch once when modal opens
    if (show && onFetchSubscriptions && !hasFetched.current) {
      hasFetched.current = true;
      onFetchSubscriptions();
    }
    // Reset when modal closes
    if (!show) {
      hasFetched.current = false;
    }
  }, [show, onFetchSubscriptions]);

  const getTypeLabel = (type) => {
    switch (type) {
      case "company":
        return "Thẻ công ty";
      case "monthly":
        return "Thẻ tháng";
      case "regular":
        return "Khách lẻ";
      default:
        return type;
    }
  };

  const getTypeBadge = (type) => {
    switch (type) {
      case "company":
        return "bg-primary";
      case "monthly":
        return "bg-info";
      case "regular":
        return "bg-warning";
      default:
        return "bg-secondary";
    }
  };

  if (!show) return null;

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
      <div
        className="modal fade show d-block"
        tabIndex="-1"
        style={{ zIndex: 1055 }}
        onClick={onClose}
      >
        <div
          className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-content bg-dark text-white border-secondary shadow-lg">
            <div className="modal-header border-secondary">
              <h5 className="modal-title">
                <i className="bi bi-card-list me-2"></i>
                Danh sách thuê bao
              </h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
              ></button>
            </div>
            <div className="modal-body p-0">
              {subscriptions.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-card-heading display-1 d-block mb-3"></i>
                  <p>Chưa có dữ liệu thuê bao</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-dark table-hover border-secondary mb-0 align-middle">
                    <thead className="bg-black text-white-50">
                      <tr>
                        <th className="ps-4 py-3">Biển số</th>
                        <th className="py-3">Chủ xe</th>
                        <th className="py-3">Loại</th>
                        <th className="py-3">SĐT</th>
                        <th className="pe-4 py-3 text-end">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscriptions.map((sub, index) => (
                        <tr key={sub.id || index}>
                          <td className="ps-4 py-3 fw-bold">{sub.plate_number}</td>
                          <td className="py-3">{sub.owner_name || "-"}</td>
                          <td className="py-3">
                            <span className={`badge ${getTypeBadge(sub.type)}`}>
                              {getTypeLabel(sub.type)}
                            </span>
                          </td>
                          <td className="py-3">{sub.phone || "-"}</td>
                          <td className="pe-4 py-3 text-end">
                            <span
                              className={`badge ${
                                sub.status === "active"
                                  ? "bg-success"
                                  : "bg-secondary"
                              }`}
                              style={{ width: "80px" }}
                            >
                              {sub.status === "active" ? "Hoạt động" : "Nghỉ"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-footer border-secondary">
               <div className="me-auto text-muted small">
                  Tổng số: {subscriptions.length} thuê bao
               </div>
              <DynamicButton
                text="Đóng"
                onClick={onClose}
                variant="secondary"
                icon="bi-x-lg"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SubscriptionModal;
