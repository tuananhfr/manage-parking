import { useState, useEffect } from "react";
import { CENTRAL_URL } from "@/config";

/**
 * BankAccountSettings - Component quản lý thông tin tài khoản ngân hàng
 * Sử dụng cho VietQR integration
 */
const BankAccountSettings = ({ config, updateConfig }) => {
  const [banks, setBanks] = useState([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [selectedBank, setSelectedBank] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  // Initialize bank account config if not exists (only on first mount)
  useEffect(() => {
    if (!config?.bank_account) {
      // Initialize each field separately using the correct updateConfig signature
      updateConfig("bank_account", "account_number", "");
      updateConfig("bank_account", "account_name", "");
      updateConfig("bank_account", "bank_name", "");
      updateConfig("bank_account", "bank_code", "");
      updateConfig("bank_account", "description_prefix", "Chuyển tiền");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load banks from backend
  useEffect(() => {
    loadBanks();
  }, []);

  // Update selectedBank when config changes
  useEffect(() => {
    if (config.bank_account?.bank_code && banks.length > 0) {
      const bank = banks.find((b) => b.code === config.bank_account.bank_code);
      setSelectedBank(bank || null);
    }
  }, [config.bank_account?.bank_code, banks]);

  const loadBanks = async () => {
    setLoadingBanks(true);
    try {
      const response = await fetch(`${CENTRAL_URL}/api/bank-account/banks`);
      const data = await response.json();

      if (data.success && data.data) {
        setBanks(data.data);
      } else {
        console.error("Failed to load banks:", data);
      }
    } catch (error) {
      console.error("Error loading banks:", error);
    } finally {
      setLoadingBanks(false);
    }
  };

  const handleBankChange = (e) => {
    const bankCode = e.target.value;
    const bank = banks.find((b) => b.code === bankCode);

    if (bank) {
      setSelectedBank(bank);
      // Update bank_code and bank_name separately
      updateConfig("bank_account", "bank_code", bank.code);
      updateConfig("bank_account", "bank_name", bank.name);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveMessage(null);

      console.log("[BankAccountSettings] Saving config:", config);

      const response = await fetch(`${CENTRAL_URL}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      console.log("[BankAccountSettings] Save response:", data);

      if (data.success) {
        setSaveMessage({
          type: "success",
          text: "Đã lưu thông tin tài khoản ngân hàng thành công!",
        });
      } else {
        setSaveMessage({
          type: "error",
          text: "Lưu thất bại: " + (data.message || "Unknown error"),
        });
      }
    } catch (error) {
      console.error("[BankAccountSettings] Save error:", error);
      setSaveMessage({
        type: "error",
        text: "Lỗi khi lưu: " + error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!config.bank_account) {
    return null;
  }

  return (
    <div>
      <h6 className="border-bottom pb-2 mb-3">
        <i className="bi bi-bank me-2"></i>
        Thông tin Tài khoản Ngân hàng
      </h6>

      {/* Save Message */}
      {saveMessage && (
        <div
          className={`alert alert-${
            saveMessage.type === "success" ? "success" : "danger"
          } mb-3`}
        >
          <i
            className={`bi bi-${
              saveMessage.type === "success" ? "check-circle" : "x-circle"
            } me-2`}
          ></i>
          {saveMessage.text}
        </div>
      )}

      <div className="alert alert-info mb-3">
        <i className="bi bi-info-circle me-2"></i>
        <strong>VietQR Integration:</strong> Khai báo thông tin tài khoản ngân
        hàng để tạo mã QR thanh toán cho khách hàng.
      </div>

      {/* Bank Account Information */}
      <div className="card bg-dark border-secondary mb-3">
        <div className="card-body">
          <h6 className="card-title mb-3 text-white">
            <i className="bi bi-person-badge me-2"></i>
            Thông tin Tài khoản
          </h6>

          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label small">
                Ngân hàng <span className="text-danger">*</span>
              </label>
              {loadingBanks ? (
                <div className="form-control form-control-sm">
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Đang tải danh sách ngân hàng...
                </div>
              ) : (
                <select
                  className="form-select form-select-sm"
                  value={config.bank_account?.bank_code || ""}
                  onChange={handleBankChange}
                >
                  <option value="">-- Chọn ngân hàng --</option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.code}>
                      {bank.shortName} ({bank.code})
                    </option>
                  ))}
                </select>
              )}
              <small className="text-muted">
                Danh sách ngân hàng từ VietQR
              </small>
            </div>

            <div className="col-md-6">
              <label className="form-label small">
                Số tài khoản <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                className="form-control form-control-sm"
                value={config.bank_account?.account_number || ""}
                onChange={(e) =>
                  updateConfig("bank_account", "account_number", e.target.value)
                }
                placeholder="0123456789"
              />
            </div>

            <div className="col-md-12">
              <label className="form-label small">
                Tên chủ tài khoản <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                className="form-control form-control-sm"
                value={config.bank_account?.account_name || ""}
                onChange={(e) =>
                  updateConfig(
                    "bank_account",
                    "account_name",
                    e.target.value.toUpperCase()
                  )
                }
                placeholder="NGUYEN VAN A"
              />
              <small className="text-muted">Tên sẽ tự động viết hoa</small>
            </div>

            <div className="col-md-12">
              <label className="form-label small">
                Tiền tố nội dung chuyển khoản
              </label>
              <input
                type="text"
                className="form-control form-control-sm"
                value={config.bank_account?.description_prefix || "Chuyển tiền"}
                onChange={(e) =>
                  updateConfig(
                    "bank_account",
                    "description_prefix",
                    e.target.value
                  )
                }
                placeholder="Chuyển tiền"
              />
              <small className="text-muted">
                Ví dụ: "
                {config.bank_account?.description_prefix || "Chuyển tiền"}{" "}
                PK001-01"
              </small>
            </div>
          </div>
        </div>
      </div>

      {/* Bank Logo Preview */}
      {selectedBank && (
        <div className="card bg-dark border-primary mb-3">
          <div className="card-body">
            <h6 className="card-title text-primary mb-3">
              <i className="bi bi-image me-2"></i>
              Ngân hàng đã chọn
            </h6>
            <div className="row align-items-center">
              <div className="col-md-3 text-center">
                {selectedBank.logo && (
                  <img
                    src={selectedBank.logo}
                    alt={selectedBank.name}
                    style={{ maxWidth: "100px", maxHeight: "60px" }}
                    className="img-fluid"
                  />
                )}
              </div>
              <div className="col-md-9">
                <table className="table table-sm table-borderless table-dark mb-0">
                  <tbody>
                    <tr>
                      <td className="text-muted" style={{ width: "30%" }}>
                        Tên ngân hàng:
                      </td>
                      <td>
                        <strong>{selectedBank.name}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td className="text-muted">Tên viết tắt:</td>
                      <td>
                        <strong>{selectedBank.shortName}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td className="text-muted">Mã ngân hàng:</td>
                      <td>
                        <span className="badge bg-primary">
                          {selectedBank.code}
                        </span>
                      </td>
                    </tr>
                    {selectedBank.bin && (
                      <tr>
                        <td className="text-muted">BIN:</td>
                        <td>
                          <code>{selectedBank.bin}</code>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Payment Info */}
      {config.bank_account?.account_number &&
        config.bank_account?.bank_code &&
        config.bank_account?.account_name && (
          <div className="card bg-dark border-success">
            <div className="card-body">
              <h6 className="card-title text-success mb-3">
                <i className="bi bi-qr-code me-2"></i>
                Thông tin thanh toán
              </h6>
              <div className="bg-success bg-opacity-10 rounded p-3 mb-3">
                <div className="row">
                  <div className="col-md-12">
                    <table className="table table-sm table-borderless table-dark mb-0">
                      <tbody>
                        <tr>
                          <td className="text-muted" style={{ width: "40%" }}>
                            Ngân hàng:
                          </td>
                          <td>
                            <strong>{config.bank_account.bank_name}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td className="text-muted">Mã NH:</td>
                          <td>
                            <span className="badge bg-success">
                              {config.bank_account.bank_code}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="text-muted">Số TK:</td>
                          <td>
                            <strong>
                              {config.bank_account.account_number}
                            </strong>
                          </td>
                        </tr>
                        <tr>
                          <td className="text-muted">Chủ TK:</td>
                          <td>
                            <strong>{config.bank_account.account_name}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="text-center">
                <small className="text-muted">
                  <i className="bi bi-check-circle me-1"></i>
                  Cấu hình đã đầy đủ. Hệ thống sẵn sàng tạo mã QR thanh toán.
                </small>
              </div>
            </div>
          </div>
        )}

      {/* Save Button */}
      <div className="text-end mt-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <span className="spinner-border spinner-border-sm me-2"></span>
              Đang lưu...
            </>
          ) : (
            <>
              <i className="bi bi-save me-2"></i>
              Lưu thông tin tài khoản
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default BankAccountSettings;
