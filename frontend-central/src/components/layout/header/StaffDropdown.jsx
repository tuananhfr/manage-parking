import { useEffect } from "react";
/**
 * StaffDropdown - Component dropdown quản lý người trực
 */
const StaffDropdown = ({ staff, onFetchStaff, onToggleStatus, onClose }) => {
  useEffect(() => {
    if (onFetchStaff) {
      onFetchStaff();
    }
  }, [onFetchStaff]);

  return (
    <>
      <div
        className="position-fixed"
        style={{
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999,
        }}
        onClick={onClose}
      ></div>
      <div
        className="position-fixed bg-white border rounded shadow-lg"
        style={{
          top: "60px",
          right: "16px",
          minWidth: "320px",
          maxHeight: "450px",
          overflowY: "auto",
          zIndex: 1000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-bottom bg-light">
          <div className="d-flex justify-content-between align-items-center">
            <strong>
              <i className="bi bi-people me-2"></i>
              Danh sách người trực
            </strong>
            <button
              className="btn-close btn-close-sm"
              onClick={onClose}
            ></button>
          </div>
        </div>
        <div
          className="p-2"
          style={{ maxHeight: "350px", overflowY: "auto" }}
        >
          {staff.length === 0 ? (
            <div className="text-muted text-center py-3">
              <small>Chưa có dữ liệu người trực</small>
            </div>
          ) : (
            staff.map((person, index) => (
              <div
                key={person.name || index}
                className="form-check py-2 border-bottom"
              >
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={person.status === "active"}
                  onChange={() => onToggleStatus(person.name)}
                  id={`staff-${person.name}`}
                />
                <label
                  className="form-check-label d-flex justify-content-between align-items-center w-100"
                  htmlFor={`staff-${person.name}`}
                  style={{ cursor: "pointer" }}
                >
                  <div className="flex-grow-1">
                    <div className="fw-bold">{person.name}</div>
                    <div className="text-muted small">
                      {person.position || "Bảo vệ"}
                    </div>
                    {(person.start_time || person.end_time) && (
                      <div className="text-muted small mt-1">
                        <i className="bi bi-clock me-1"></i>
                        {person.start_time || "--:--"} - {person.end_time || "--:--"}
                      </div>
                    )}
                  </div>
                  <span
                    className={`badge ms-2 ${
                      person.status === "active"
                        ? "bg-success"
                        : "bg-secondary"
                    }`}
                  >
                    {person.status === "active" ? "Hoạt động" : "Nghỉ"}
                  </span>
                </label>
              </div>
            ))
          )}
        </div>
        <div className="p-2 border-top bg-light">
          <button
            className="btn btn-secondary btn-sm w-100"
            onClick={onClose}
          >
            <i className="bi bi-x-circle me-1"></i>
            Đóng
          </button>
        </div>
      </div>
    </>
  );
};

export default StaffDropdown;
