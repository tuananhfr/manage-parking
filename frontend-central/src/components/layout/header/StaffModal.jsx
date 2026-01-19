import React, { useEffect, useRef } from "react";
import DynamicButton from "@/components/button/DynamicButton";

/**
 * StaffModal - Modal hiển thị danh sách người trực (thay thế Dropdown)
 * Giao diện bảng giống Settings, có tính năng toggle status
 */
const StaffModal = ({ show, onClose, staff, onFetchStaff }) => {
  const hasFetched = useRef(false);
  
  useEffect(() => {
    // Only fetch once when modal opens
    if (show && onFetchStaff && !hasFetched.current) {
      hasFetched.current = true;
      onFetchStaff();
    }
    // Reset when modal closes
    if (!show) {
      hasFetched.current = false;
    }
  }, [show, onFetchStaff]);

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
                <i className="bi bi-people-fill me-2"></i>
                Danh sách người trực
              </h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
              ></button>
            </div>
            <div className="modal-body p-0">
              {staff.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-person-x display-1 d-block mb-3"></i>
                  <p>Chưa có dữ liệu người trực</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-dark table-hover border-secondary mb-0 align-middle">
                    <thead className="bg-black text-white-50">
                      <tr>
                        <th className="ps-4 py-3">Tên</th>
                        <th className="py-3">Chức vụ</th>
                        <th className="py-3">Bắt đầu</th>
                        <th className="py-3">Kết thúc</th>
                        <th className="pe-4 py-3 text-end">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map((person, index) => (
                        <tr 
                          key={person.name || index} 
                          className={person.status === "active" ? "bg-secondary bg-opacity-10" : ""}
                        >
                          <td className="ps-4 py-3 fw-bold">{person.name}</td>
                          <td className="py-3">{person.position || "Bảo vệ"}</td>
                          <td className="py-3">
                            {person.start_time ? (
                              <span className="badge bg-secondary font-monospace border border-secondary">
                                {person.start_time}
                              </span>
                            ) : (
                              <span className="text-muted small">-</span>
                            )}
                          </td>
                          <td className="py-3">
                            {person.end_time ? (
                              <span className="badge bg-secondary font-monospace border border-secondary">
                                {person.end_time}
                              </span>
                            ) : (
                              <span className="text-muted small">-</span>
                            )}
                          </td>
                          <td className="pe-4 py-3 text-end">
                            <span
                              className={`badge ${
                                person.status === "active"
                                  ? "bg-success"
                                  : "bg-secondary"
                              }`}
                              style={{ width: "80px" }}
                            >
                              {person.status === "active" ? "Hoạt động" : "Nghỉ"}
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

export default StaffModal;
