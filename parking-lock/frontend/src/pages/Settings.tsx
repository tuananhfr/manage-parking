import { useState, useEffect } from "react";
import settingsApi from "../services/settingsApi";

export default function Settings() {
  const [globalRate, setGlobalRate] = useState<number>(50000);
  const [inputRate, setInputRate] = useState<string>("50000");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGlobalRate();
  }, []);

  const loadGlobalRate = async () => {
    try {
      setLoading(true);
      const res = await settingsApi.getGlobalHourlyRate();
      setGlobalRate(res.data.rate);
      setInputRate(res.data.rate.toString());
    } catch (error) {
      console.error("Failed to load global hourly rate:", error);
      alert("Failed to load global hourly rate");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGlobalRate = async () => {
    const rate = parseInt(inputRate);

    if (!rate || rate <= 0) {
      alert("Vui lòng nhập giá hợp lệ (> 0)");
      return;
    }

    if (
      !confirm(
        `Cập nhật giá toàn hệ thống thành ${rate.toLocaleString(
          "vi-VN"
        )} đ/giờ?\n\nGiá này sẽ được áp dụng cho TẤT CẢ các khóa trong hệ thống.`
      )
    ) {
      return;
    }

    try {
      setSaving(true);
      const res = await settingsApi.updateGlobalHourlyRate(rate);
      // Update both state values to reflect the new rate
      setGlobalRate(rate);
      setInputRate(rate.toString());
      alert(
        `Đã cập nhật giá thành công!\n\n${
          res.data.lockers_updated
        } khóa đã được cập nhật với giá ${rate.toLocaleString("vi-VN")} đ/giờ`
      );
      // Reload from API to ensure sync (optional but safer)
      await loadGlobalRate();
    } catch (error) {
      console.error("Failed to update global hourly rate:", error);
      alert("Failed to update global hourly rate");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <h5 className="card-title mb-0">
                <i className="bi bi-gear-fill me-2"></i>
                Cài đặt hệ thống
              </h5>
            </div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-6">
                  <h6 className="mb-3">Giá đỗ xe toàn hệ thống</h6>

                  <div className="alert alert-info">
                    <i className="bi bi-info-circle me-2"></i>
                    Khi thay đổi giá toàn hệ thống, giá sẽ được áp dụng cho{" "}
                    <strong>TẤT CẢ</strong> các khóa. Sau đó, bạn có thể tùy
                    chỉnh giá riêng cho từng khóa (ví dụ: VIP spots).
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold">Giá hiện tại</label>
                    <div className="display-6 text-primary">
                      {globalRate.toLocaleString("vi-VN")} đ/giờ
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold">
                      Giá mới (VND/giờ)
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      value={inputRate}
                      onChange={(e) => setInputRate(e.target.value)}
                      placeholder="Nhập giá theo giờ..."
                      min="1"
                      step="1000"
                    />
                    <small className="text-muted">
                      Ví dụ: 50000 = 50,000 đồng/giờ
                    </small>
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={handleUpdateGlobalRate}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2"></span>
                        Đang cập nhật...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-save me-2"></i>
                        Cập nhật giá toàn hệ thống
                      </>
                    )}
                  </button>
                </div>

                <div className="col-md-6">
                  <h6 className="mb-3">Cách tính giá</h6>

                  <div className="alert alert-secondary">
                    <h6 className="alert-heading">
                      <i className="bi bi-calculator me-2"></i>
                      Quy tắc tính giá
                    </h6>
                    <ul className="mb-0">
                      <li>
                        <strong>Làm tròn lên:</strong> Bất kỳ phần giờ nào cũng
                        tính là 1 giờ
                        <br />
                        <small className="text-muted">
                          (Ví dụ: 10 phút = 1 giờ, 1 giờ 5 phút = 2 giờ)
                        </small>
                      </li>
                      <li>
                        <strong>Công thức:</strong> Số giờ (làm tròn) × Giá theo
                        giờ
                        <br />
                        <small className="text-muted">
                          (Ví dụ: 5 giờ × 50,000đ = 250,000đ)
                        </small>
                      </li>
                      <li>
                        <strong>Thời gian tính từ:</strong> Khi xe vào (xe chiếm
                        chỗ)
                        <br />
                        <small className="text-muted">
                          (Không phải từ lúc khóa UP)
                        </small>
                      </li>
                    </ul>
                  </div>

                  <div className="alert alert-warning">
                    <h6 className="alert-heading">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      Lưu ý
                    </h6>
                    <p className="mb-0">
                      Để set giá riêng cho từng khóa (VIP spots), vào trang{" "}
                      <strong>Locker List</strong> và click nút{" "}
                      <i className="bi bi-gear"></i> Config của khóa đó.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
