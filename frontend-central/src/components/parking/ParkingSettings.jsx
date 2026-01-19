import { useState, useEffect } from "react";
import { parkingBackendApi } from "../../services/parkingBackendApi";

export default function ParkingSettings() {
  // Settings State
  const [price, setPrice] = useState(50000);
  const [freeTime, setFreeTime] = useState(15);
  const [warningTime, setWarningTime] = useState(10);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await parkingBackendApi.getGlobalConfig();
      if (response.success && response.data) {
        setPrice(response.data.price || 50000);
        setFreeTime(response.data.free_time || 15);
        setWarningTime(response.data.warning_time || 10);
      }
    } catch (error) {
      console.error("Failed to load config", error);
      // Keep default values on error
    }
  };

  const handleApply = async () => {
    if (
      !confirm(
        `Bạn có chắc muốn áp dụng cài đặt này cho TOÀN BỘ hệ thống (tất cả các bãi xe)?\nGiá: ${price}\nFree Time: ${freeTime}p\nWarning Time: ${warningTime}s`
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const config = {
        price: Number(price),
        free_time: Number(freeTime),
        warning_time: Number(warningTime),
      };

      const res = await parkingBackendApi.applyGlobalConfig(config);

      if (res.success) {
        setResult(res.data);
        alert("Cập nhật thành công!");
      }
    } catch (error) {
      console.error("Apply config failed", error);
      alert("Có lỗi xảy ra khi cập nhật!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container-fluid py-3">
      <h4>
        <i className="bi bi-gear-fill me-2"></i>Cài đặt hệ thống
      </h4>

      <div className="row mt-4">
        <div className="col-md-6">
          <div className="card shadow-sm bg-dark border-secondary">
            <div className="card-header bg-primary text-white border-secondary">
              <i className="bi bi-sliders me-2"></i>Thiết lập thông số chung
            </div>
            <div className="card-body">
              <div className="alert alert-warning small bg-dark text-warning border-warning">
                <i className="bi bi-exclamation-triangle me-2"></i>
                <strong>Lưu ý quan trọng:</strong> Khi nhấn "Áp dụng", hệ thống
                sẽ gửi lệnh cập nhật xuống <strong>TẤT CẢ</strong> các khóa của{" "}
                <strong>MỌI BÃI XE</strong> đang kết nối.
              </div>

              <div className="mb-3">
                <label className="form-label fw-bold text-white">
                  Giá vé theo giờ (VNĐ)
                </label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control bg-dark text-white border-secondary"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <span className="input-group-text bg-secondary text-white border-secondary">
                    đ/giờ
                  </span>
                </div>
                <div className="form-text text-secondary">
                  Ví dụ: 50000 = 50k/giờ
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold text-white">
                    Thời gian miễn phí (Free Time)
                  </label>
                  <div className="input-group">
                    <input
                      type="number"
                      className="form-control bg-dark text-white border-secondary"
                      value={freeTime}
                      onChange={(e) => setFreeTime(e.target.value)}
                    />
                    <span className="input-group-text bg-secondary text-white border-secondary">
                      phút
                    </span>
                  </div>
                  <div className="form-text text-secondary">
                    Xe đỗ dưới thời gian này sẽ không tính phí
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold text-white">
                    Cảnh báo đóng (Warning Time)
                  </label>
                  <div className="input-group">
                    <input
                      type="number"
                      className="form-control bg-dark text-white border-secondary"
                      value={warningTime}
                      onChange={(e) => setWarningTime(e.target.value)}
                    />
                    <span className="input-group-text bg-secondary text-white border-secondary">
                      giây
                    </span>
                  </div>
                  <div className="form-text text-secondary">
                    Loa kêu trước khi gập càng khóa
                  </div>
                </div>
              </div>

              <div className="d-grid mt-3">
                <button
                  className="btn btn-primary"
                  onClick={handleApply}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Đang đồng bộ...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-hdd-network me-2"></i>
                      Áp dụng cho toàn hệ thống
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card shadow-sm h-100 bg-dark border-secondary">
            <div className="card-header bg-secondary text-white border-secondary">
              <i className="bi bi-clipboard-data me-2"></i>Kết quả thực hiện
            </div>
            <div className="card-body">
              {!result && !loading && (
                <div className="text-center text-secondary py-5">
                  Chưa có dữ liệu. Vui lòng thực hiện cấu hình.
                </div>
              )}

              {loading && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary mb-3"></div>
                  <p className="text-white">
                    Đang gửi lệnh cấu hình xuống tất cả bãi xe...
                  </p>
                  <p className="small text-secondary">
                    Vui lòng không tắt trình duyệt
                  </p>
                </div>
              )}

              {result && (
                <div>
                  <div className="d-flex justify-content-between mb-3 border-bottom border-secondary pb-2">
                    <span className="text-white">Tổng số bãi xe:</span>
                    <span className="fw-bold text-white">
                      {result.total_backends}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between mb-3 border-bottom border-secondary pb-2">
                    <span className="text-white">Tổng số khóa:</span>
                    <span className="fw-bold text-white">
                      {result.total_lockers}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between mb-3 border-bottom border-secondary pb-2">
                    <span className="text-success">Thành công:</span>
                    <span className="fw-bold text-success">
                      {result.success}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between mb-3">
                    <span className="text-danger">Thất bại:</span>
                    <span className="fw-bold text-danger">{result.failed}</span>
                  </div>

                  {result.failed > 0 && (
                    <div className="alert alert-danger mt-3 bg-dark text-danger border-danger">
                      Có {result.failed} thiết bị không nhận được cấu hình. Có
                      thể do mất kết nối mạng.
                      {result.errors && result.errors.length > 0 && (
                        <ul className="mb-0 mt-2 small">
                          {result.errors.map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {result.success === result.total_lockers &&
                    result.total_lockers > 0 && (
                      <div className="alert alert-success mt-3 bg-dark text-success border-success">
                        <i className="bi bi-check-circle me-2"></i>
                        Đã cấu hình thành công 100% thiết bị!
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
