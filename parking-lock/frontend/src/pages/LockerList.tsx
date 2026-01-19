import { useState, useEffect } from "react";
import lockerApi from "../services/lockerApi";
import socketService from "../services/socket";

import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(duration);
dayjs.extend(relativeTime);

// Format seconds to HH:MM:SS
function formatCountdown(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}`;
}

// Countdown Timer Component (for total remaining time)
function CountdownTimer({
  remainingSeconds,
}: {
  remainingSeconds: number | null;
}) {
  const [countdown, setCountdown] = useState<number | null>(remainingSeconds);

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) {
      setCountdown(null);
      return;
    }

    setCountdown(remainingSeconds);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 0) {
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [remainingSeconds]);

  if (countdown === null || countdown <= 0) {
    return <span className="text-muted">-</span>;
  }

  return (
    <div>
      <span className={`badge ${countdown <= 60 ? "bg-danger" : "bg-success"}`}>
        {formatCountdown(countdown)}
      </span>
      {countdown <= 60 && (
        <div className="text-danger small mt-1">
          <i className="bi bi-exclamation-triangle-fill me-1"></i>
          Sắp tự động khóa
        </div>
      )}
    </div>
  );
}

// Payment Modal Component
function PaymentModal({
  locker,
  show,
  onClose,
  onConfirm,
}: {
  locker: Locker | null;
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Handle body scroll lock when modal is open
  useEffect(() => {
    if (show) {
      document.body.classList.add("modal-open");
      document.body.style.overflow = "hidden";
    } else {
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
    }
    return () => {
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
    };
  }, [show]);

  if (!show || !locker) return null;

  const carEnterTime =
    locker.occupied &&
    locker.last_action &&
    (locker.last_action.includes("CAR_ENTERED") ||
      locker.last_action.includes("CAR_ENTER"))
      ? locker.last_action_time
      : null;

  const billingStartTime =
    carEnterTime &&
    locker.lock_free_time !== null &&
    locker.lock_free_time !== undefined
      ? dayjs(carEnterTime).add(locker.lock_free_time, "minute").toISOString()
      : null;

  const parkingFee = (locker as any).parking_fee || 0;
  const hourlyRate = locker.hourly_rate || 0;
  const now = dayjs();

  // Calculate parking duration
  const parkingDuration = carEnterTime
    ? dayjs.duration(now.diff(dayjs(carEnterTime)))
    : null;

  // Calculate paid duration (after free time)
  const paidDuration =
    billingStartTime && dayjs(billingStartTime).isBefore(now)
      ? dayjs.duration(now.diff(dayjs(billingStartTime)))
      : null;

  return (
    <>
      {/* Modal Backdrop */}
      {show && (
        <div
          className="modal-backdrop fade show"
          onClick={onClose}
          style={{ zIndex: 1040 }}
        ></div>
      )}

      {/* Modal */}
      <div
        className={`modal fade ${show ? "show" : ""}`}
        style={{ display: show ? "block" : "none", zIndex: 1050 }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paymentModalLabel"
        onClick={(e) => {
          // Close modal when clicking outside modal content
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header bg-primary text-white">
              <h5 className="modal-title" id="paymentModalLabel">
                <i className="bi bi-credit-card me-2"></i>
                Thanh toán phí đỗ xe
              </h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={onClose}
                aria-label="Close"
              ></button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <h6 className="text-muted mb-3">Thông tin locker</h6>
                <div className="row mb-2">
                  <div className="col-4 fw-bold">Locker ID:</div>
                  <div className="col-8">
                    <span className="badge bg-primary">{locker.lock_id}</span>
                  </div>
                </div>
                <div className="row mb-2">
                  <div className="col-4 fw-bold">Tên:</div>
                  <div className="col-8">{locker.name || "-"}</div>
                </div>
              </div>

              <hr />

              <div className="mb-3">
                <h6 className="text-muted mb-3">Thông tin đỗ xe</h6>
                {carEnterTime ? (
                  <>
                    <div className="row mb-2">
                      <div className="col-4 fw-bold">Thời gian xe vào:</div>
                      <div className="col-8">
                        {dayjs(carEnterTime).format("DD/MM/YYYY HH:mm:ss")}
                      </div>
                    </div>
                    {parkingDuration && (
                      <div className="row mb-2">
                        <div className="col-4 fw-bold">Thời gian đỗ:</div>
                        <div className="col-8">
                          {parkingDuration.hours()} giờ{" "}
                          {parkingDuration.minutes()} phút
                        </div>
                      </div>
                    )}
                    {billingStartTime && (
                      <>
                        <div className="row mb-2">
                          <div className="col-4 fw-bold">
                            Bắt đầu tính tiền:
                          </div>
                          <div className="col-8">
                            {dayjs(billingStartTime).format(
                              "DD/MM/YYYY HH:mm:ss"
                            )}
                          </div>
                        </div>
                        {paidDuration && (
                          <div className="row mb-2">
                            <div className="col-4 fw-bold">
                              Thời gian tính tiền:
                            </div>
                            <div className="col-8">
                              {paidDuration.hours()} giờ{" "}
                              {paidDuration.minutes()} phút
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="text-muted">Chưa có thông tin xe vào</div>
                )}
              </div>

              <hr />

              <div className="mb-3">
                <h6 className="text-muted mb-3">Thông tin thanh toán</h6>
                <div className="row mb-2">
                  <div className="col-4 fw-bold">Giá theo giờ:</div>
                  <div className="col-8">
                    {hourlyRate > 0
                      ? `${hourlyRate.toLocaleString("vi-VN")} đ/giờ`
                      : "Chưa cấu hình"}
                  </div>
                </div>
                {locker.lock_free_time !== null &&
                  locker.lock_free_time !== undefined && (
                    <div className="row mb-2">
                      <div className="col-4 fw-bold">Thời gian miễn phí:</div>
                      <div className="col-8">{locker.lock_free_time} phút</div>
                    </div>
                  )}
                <div className="row mb-2">
                  <div className="col-4 fw-bold">Thời gian hiện tại:</div>
                  <div className="col-8">
                    {now.format("DD/MM/YYYY HH:mm:ss")}
                  </div>
                </div>
              </div>

              <hr />

              <div className="mb-3">
                <div className="card bg-light">
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-center">
                      <h5 className="mb-0">Tổng tiền phải trả:</h5>
                      <h3 className="mb-0 text-success fw-bold">
                        {parkingFee.toLocaleString("vi-VN")} đ
                      </h3>
                    </div>
                    {parkingFee === 0 && (
                      <div className="mt-2">
                        {hourlyRate <= 0 ? (
                          <div className="alert alert-warning mb-0 py-2">
                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                            <strong>Chưa cấu hình giá!</strong>
                            <br />
                            <small>
                              Vui lòng cấu hình giá theo giờ trong trang
                              Settings hoặc Configuration để tính tiền đỗ xe.
                            </small>
                          </div>
                        ) : (
                          <div className="text-muted small mt-2">
                            <i className="bi bi-info-circle me-1"></i>
                            Đang trong thời gian miễn phí
                          </div>
                        )}
                      </div>
                    )}
                    {parkingFee > 0 && (
                      <div className="text-muted small mt-2">
                        <i className="bi bi-info-circle me-1"></i>
                        Đã tính{" "}
                        {paidDuration
                          ? `${paidDuration.hours()} giờ ${paidDuration.minutes()} phút`
                          : ""}{" "}
                        sau thời gian miễn phí
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onConfirm}
              >
                <i className="bi bi-check-circle me-2"></i>
                Xác nhận thanh toán
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Free Time Countdown Component
function FreeTimeCountdown({
  carEnterTime,
  freeTimeMinutes,
}: {
  carEnterTime: string | null;
  freeTimeMinutes: number | null;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (
      !carEnterTime ||
      freeTimeMinutes === null ||
      freeTimeMinutes === undefined
    ) {
      setRemainingSeconds(null);
      return;
    }

    const calculateRemaining = () => {
      const enterTime = dayjs(carEnterTime);
      const now = dayjs();
      const elapsedSeconds = now.diff(enterTime, "second");
      const freeTimeSeconds = freeTimeMinutes * 60;
      const remaining = freeTimeSeconds - elapsedSeconds;
      return remaining > 0 ? remaining : 0;
    };

    setRemainingSeconds(calculateRemaining());

    const interval = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [carEnterTime, freeTimeMinutes]);

  if (remainingSeconds === null || remainingSeconds <= 0) {
    return <span className="text-muted">-</span>;
  }

  return (
    <span className="badge bg-primary">
      {formatCountdown(remainingSeconds)}
    </span>
  );
}

// Warning Time Countdown Component
function WarningTimeCountdown({
  carEnterTime,
  freeTimeMinutes,
  warningTimeSeconds,
}: {
  carEnterTime: string | null;
  freeTimeMinutes: number | null;
  warningTimeSeconds: number | null;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (
      !carEnterTime ||
      freeTimeMinutes === null ||
      freeTimeMinutes === undefined ||
      warningTimeSeconds === null ||
      warningTimeSeconds === undefined
    ) {
      setRemainingSeconds(null);
      return;
    }

    const calculateRemaining = () => {
      const enterTime = dayjs(carEnterTime);
      const now = dayjs();
      const elapsedSeconds = now.diff(enterTime, "second");
      const freeTimeSeconds = freeTimeMinutes * 60;
      const totalTimeSeconds = freeTimeSeconds + warningTimeSeconds;

      // Only show warning countdown if free time has passed
      if (elapsedSeconds < freeTimeSeconds) {
        return null; // Still in free time
      }

      const remaining = totalTimeSeconds - elapsedSeconds;
      return remaining > 0 ? remaining : 0;
    };

    const remaining = calculateRemaining();
    setRemainingSeconds(remaining);

    if (remaining === null) {
      return;
    }

    const interval = setInterval(() => {
      const newRemaining = calculateRemaining();
      setRemainingSeconds(newRemaining);
      if (newRemaining === null || newRemaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [carEnterTime, freeTimeMinutes, warningTimeSeconds]);

  if (remainingSeconds === null) {
    return <span className="text-muted">Chưa đến</span>;
  }

  if (remainingSeconds <= 0) {
    return <span className="text-muted">Đã hết</span>;
  }

  return (
    <span
      className={`badge ${
        remainingSeconds <= 60 ? "bg-danger" : "bg-warning text-dark"
      }`}
    >
      {formatCountdown(remainingSeconds)}
    </span>
  );
}

export default function LockerList() {
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [loading, setLoading] = useState(true);
  const [controllingLocker, setControllingLocker] = useState<string | null>(
    null
  );
  const [configLocker, setConfigLocker] = useState<string | null>(null);
  const [configData, setConfigData] = useState({
    upProtect: "",
    downProtect: "",
    freeTime: "",
    warningTime: "",
    hourlyRate: "",
  });
  const [paymentModal, setPaymentModal] = useState<{
    show: boolean;
    locker: Locker | null;
  }>({ show: false, locker: null });

  useEffect(() => {
    loadLockers();

    // Listen for real-time locker status changes via WebSocket
    const handleLockerStatusChange = async (data: any) => {
      const {
        lock_id,
        locker: lockerData,
        new_status,
        new_occupied,
        new_mode,
      } = data;

      // If backend sends full locker data, use it directly (preferred)
      if (lockerData) {
        setLockers((prevLockers) =>
          prevLockers.map((locker) => {
            if (locker.lock_id === lock_id) {
              // Merge with existing locker data, prioritizing new data
              return {
                ...locker,
                ...lockerData,
              };
            }
            return locker;
          })
        );
      } else {
        // Fallback: reload the specific locker from API to get all fields
        try {
          const res = await lockerApi.getLockerById(lock_id);
          setLockers((prevLockers) =>
            prevLockers.map((locker) => {
              if (locker.lock_id === lock_id) {
                return res.data;
              }
              return locker;
            })
          );
        } catch (error) {
          console.error(`Failed to reload locker ${lock_id}:`, error);
          // If API fails, still try to update with partial data from event
          setLockers((prevLockers) =>
            prevLockers.map((locker) => {
              if (locker.lock_id === lock_id) {
                return {
                  ...locker,
                  status: new_status || locker.status,
                  occupied:
                    new_occupied !== undefined ? new_occupied : locker.occupied,
                  mode: new_mode || locker.mode,
                };
              }
              return locker;
            })
          );
        }
      }
    };

    // Subscribe to locker status changes
    socketService.on("locker:status:changed", handleLockerStatusChange);

    // Listen for payment confirmed events (from webhook)
    const handlePaymentConfirmed = async (data: any) => {
      const { lock_id, locker: lockerData, order_id } = data;

      console.log(`Payment confirmed for order ${order_id}, locker ${lock_id}`);

      // If payment modal is open for this locker, close it automatically
      setPaymentModal((prevModal) => {
        if (prevModal.show && prevModal.locker?.lock_id === lock_id) {
          alert(
            `Thanh toán đã được xác nhận tự động qua webhook!\nMã đơn: ${order_id}\nLocker ${lock_id} đã được mở khóa.`
          );
          return { show: false, locker: null };
        }
        return prevModal;
      });

      // Update locker data if provided
      if (lockerData) {
        setLockers((prevLockers) =>
          prevLockers.map((locker) => {
            if (locker.lock_id === lock_id) {
              return {
                ...locker,
                ...lockerData,
              };
            }
            return locker;
          })
        );
      } else {
        // Reload locker to get updated status
        try {
          const res = await lockerApi.getLockerById(lock_id);
          setLockers((prevLockers) =>
            prevLockers.map((locker) => {
              if (locker.lock_id === lock_id) {
                return res.data;
              }
              return locker;
            })
          );
        } catch (error) {
          console.error(
            `Failed to reload locker ${lock_id} after payment:`,
            error
          );
        }
      }
    };

    socketService.on("payment:confirmed", handlePaymentConfirmed);

    // Cleanup on unmount
    return () => {
      socketService.off("locker:status:changed", handleLockerStatusChange);
      socketService.off("payment:confirmed", handlePaymentConfirmed);
    };
  }, []);

  const loadLockers = async () => {
    try {
      // Only load connected lockers
      const res = await lockerApi.getLockers({ connected: true, limit: 100 });
      setLockers(res.data);
    } catch (error) {
      console.error("Failed to load lockers:", error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh lockers every 5 seconds to update remaining_time
  useEffect(() => {
    const interval = setInterval(() => {
      loadLockers();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleControl = async (
    lockId: string,
    action: "open" | "close" | "stop" | "normal"
  ) => {
    if (!confirm(`Are you sure you want to ${action} locker ${lockId}?`)) {
      return;
    }

    setControllingLocker(lockId);
    try {
      await lockerApi.controlLocker(lockId, { action, mode: "normal" });
      alert(`Command sent to ${action} locker ${lockId}`);
      setTimeout(loadLockers, 1000); // Reload after 1s
    } catch (error) {
      console.error(`Failed to ${action} locker:`, error);
      alert(`Failed to send command`);
    } finally {
      setControllingLocker(null);
    }
  };

  const handleSetAttribute = async (lockId: string) => {
    if (!configData.upProtect && !configData.downProtect) {
      alert("Please enter at least one protection value (20-95)");
      return;
    }

    try {
      const data: any = {};
      if (configData.upProtect) {
        const value = parseInt(configData.upProtect);
        if (value < 20 || value > 95) {
          alert("UpProtect must be between 20 and 95");
          return;
        }
        data.up_protect = value;
      }
      if (configData.downProtect) {
        const value = parseInt(configData.downProtect);
        if (value < 20 || value > 95) {
          alert("DownProtect must be between 20 and 95");
          return;
        }
        data.down_protect = value;
      }

      await lockerApi.setLockAttribute(lockId, data);
      alert("Attribute set successfully");
      // Reload lockers to get updated values
      await loadLockers();
      // Keep config panel open and update values
      // setConfigLocker(null);
      // setConfigData({
      //   upProtect: "",
      //   downProtect: "",
      //   freeTime: "",
      //   warningTime: "",
      // });
    } catch (error) {
      console.error("Failed to set attribute:", error);
      alert("Failed to set attribute");
    }
  };

  const handleSetFreeTime = async (lockId: string) => {
    if (!configData.freeTime || parseInt(configData.freeTime) < 0) {
      alert("Please enter a valid time (>= 0 minutes)");
      return;
    }

    try {
      await lockerApi.setFreeTime(lockId, {
        time: parseInt(configData.freeTime),
      });
      alert("Free time set successfully");
      setConfigData({ ...configData, freeTime: "" });
    } catch (error) {
      console.error("Failed to set free time:", error);
      alert("Failed to set free time");
    }
  };

  const handleSetWarningTime = async (lockId: string) => {
    if (!configData.warningTime || parseInt(configData.warningTime) < 0) {
      alert("Please enter a valid time (>= 0 seconds)");
      return;
    }

    try {
      await lockerApi.setWarningTime(lockId, {
        time: parseInt(configData.warningTime),
      });
      alert("Warning time set successfully");
      // Reload lockers to get updated values
      await loadLockers();
      // Keep the value in input after successful update
      // setConfigData({ ...configData, warningTime: "" });
    } catch (error) {
      console.error("Failed to set warning time:", error);
      alert("Failed to set warning time");
    }
  };

  const handleSetHourlyRate = async (lockId: string) => {
    if (!configData.hourlyRate || parseInt(configData.hourlyRate) < 0) {
      alert("Vui lòng nhập giá hợp lệ (>= 0)");
      return;
    }

    try {
      await lockerApi.updateLocker(lockId, {
        hourly_rate: parseInt(configData.hourlyRate),
      });
      alert("Giá theo giờ đã được cập nhật thành công!");
      await loadLockers();
    } catch (error: any) {
      console.error("Failed to set hourly rate:", error);
      alert(
        `Không thể cập nhật giá: ${
          error.response?.data?.message || error.message
        }`
      );
    }
  };

  const handleCarEnter = async (lockId: string, locker: Locker) => {
    // Validate: Locker must be DOWN to allow car enter
    if (locker.status !== "DOWN") {
      alert(
        `Không thể cho xe vào! Locker phải ở trạng thái DOWN (hiện tại: ${locker.status})`
      );
      return;
    }

    // Validate: Locker must not be occupied
    if (locker.occupied) {
      alert("Locker đã có xe! Vui lòng kiểm tra lại.");
      return;
    }

    if (
      !confirm(
        `Xác nhận cho xe vào locker ${lockId}?\nLocker sẽ tự động khóa sau khi hết thời gian miễn phí.`
      )
    ) {
      return;
    }

    try {
      await lockerApi.simulateCarEnter(lockId);
      alert("Xe đã vào thành công!");
      await loadLockers();
    } catch (error: any) {
      console.error("Failed to simulate car enter:", error);
      alert(
        `Không thể cho xe vào: ${
          error.response?.data?.message || error.message
        }`
      );
    }
  };

  const handlePayment = (_lockId: string, locker: Locker) => {
    // Validate: Locker must be occupied
    if (!locker.occupied) {
      alert("Locker chưa có xe! Không thể thanh toán.");
      return;
    }

    // Show payment modal
    setPaymentModal({ show: true, locker });
  };

  const handleConfirmPayment = async () => {
    if (!paymentModal.locker) return;

    const lockId = paymentModal.locker.lock_id;

    try {
      await lockerApi.processPayment(lockId);
      alert("Thanh toán thành công! Locker đã được hạ xuống, xe có thể ra.");
      setPaymentModal({ show: false, locker: null });
      await loadLockers();
    } catch (error: any) {
      console.error("Failed to process payment:", error);
      alert(
        `Không thể xử lý thanh toán: ${
          error.response?.data?.message || error.message
        }`
      );
    }
  };

  const handleCarExit = async (lockId: string, locker: Locker) => {
    // Validate: Locker must be occupied
    if (!locker.occupied) {
      alert("Locker chưa có xe! Không thể cho xe ra.");
      return;
    }

    // Validate: Locker must be DOWN to allow car exit
    if (locker.status !== "DOWN") {
      alert(
        `Không thể cho xe ra! Locker phải ở trạng thái DOWN (hiện tại: ${locker.status})\nVui lòng thanh toán trước.`
      );
      return;
    }

    if (!confirm(`Xác nhận cho xe ra khỏi locker ${lockId}?`)) {
      return;
    }

    try {
      await lockerApi.simulateCarExit(lockId);
      alert("Xe đã ra thành công!");
      await loadLockers();
    } catch (error: any) {
      console.error("Failed to simulate car exit:", error);
      alert(
        `Không thể cho xe ra: ${error.response?.data?.message || error.message}`
      );
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
    <div>
      <h2 className="mb-4">
        <i className="bi bi-lock me-2"></i>
        Locker Management
      </h2>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Locker ID</th>
                  <th>Device</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Occupied</th>
                  <th>Thời gian xe vào</th>
                  <th>Thời gian bắt đầu tính tiền</th>
                  <th>Free Time</th>
                  <th>Warning Time</th>
                  <th>Countdown</th>
                  <th>Last Action</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lockers.map((locker) => {
                  // Get car enter time (when occupied and last_action is CAR_ENTERED)
                  const carEnterTime =
                    locker.occupied &&
                    locker.last_action &&
                    (locker.last_action.includes("CAR_ENTERED") ||
                      locker.last_action.includes("CAR_ENTER"))
                      ? locker.last_action_time
                      : null;

                  // Calculate billing start time (car enter time + free time)
                  const billingStartTime =
                    carEnterTime &&
                    locker.lock_free_time !== null &&
                    locker.lock_free_time !== undefined
                      ? dayjs(carEnterTime)
                          .add(locker.lock_free_time, "minute")
                          .toISOString()
                      : null;

                  // Get remaining time countdown
                  const remainingSeconds = (locker as any).remaining_time;

                  return (
                    <tr key={locker.lock_id}>
                      <td>
                        <strong>{locker.lock_id}</strong>
                      </td>
                      <td>{locker.device_id}</td>
                      <td>{locker.name || "-"}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span
                            className={`badge ${
                              locker.status === "UP"
                                ? "bg-success"
                                : "bg-warning"
                            }`}
                          >
                            {locker.status}
                          </span>
                          {locker.last_action &&
                            locker.last_action.includes("ERROR:") && (
                              <span
                                className="badge bg-danger"
                                title={locker.last_action}
                              >
                                <i className="bi bi-exclamation-triangle-fill me-1"></i>
                                ERROR
                              </span>
                            )}
                        </div>
                      </td>
                      <td>
                        <span className="badge bg-info">{locker.mode}</span>
                      </td>
                      <td>
                        {locker.occupied ? (
                          <span className="badge bg-danger">Yes</span>
                        ) : (
                          <span className="badge bg-secondary">No</span>
                        )}
                      </td>
                      <td>
                        {carEnterTime ? (
                          <div>
                            <div className="fw-bold">
                              {dayjs(carEnterTime).format(
                                "DD/MM/YYYY HH:mm:ss"
                              )}
                            </div>
                            <div className="text-muted small">
                              {dayjs(carEnterTime).fromNow()}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {billingStartTime ? (
                          <div>
                            <div className="fw-bold text-warning">
                              {dayjs(billingStartTime).format(
                                "DD/MM/YYYY HH:mm:ss"
                              )}
                            </div>
                            <div className="text-muted small">
                              {dayjs(billingStartTime).isBefore(dayjs())
                                ? "Đã bắt đầu tính tiền"
                                : `Bắt đầu sau ${dayjs(
                                    billingStartTime
                                  ).fromNow()}`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {locker.lock_free_time !== null &&
                        locker.lock_free_time !== undefined &&
                        carEnterTime ? (
                          <FreeTimeCountdown
                            carEnterTime={carEnterTime}
                            freeTimeMinutes={locker.lock_free_time}
                          />
                        ) : locker.lock_free_time !== null &&
                          locker.lock_free_time !== undefined ? (
                          <span className="badge bg-secondary">
                            {locker.lock_free_time} phút
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {locker.lock_warning_time !== null &&
                        locker.lock_warning_time !== undefined &&
                        carEnterTime ? (
                          <WarningTimeCountdown
                            carEnterTime={carEnterTime}
                            freeTimeMinutes={locker.lock_free_time}
                            warningTimeSeconds={locker.lock_warning_time}
                          />
                        ) : locker.lock_warning_time !== null &&
                          locker.lock_warning_time !== undefined ? (
                          <span className="badge bg-secondary">
                            {locker.lock_warning_time} giây
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        <CountdownTimer remainingSeconds={remainingSeconds} />
                      </td>
                      <td>
                        <div>
                          {locker.last_action_time
                            ? dayjs(locker.last_action_time).format(
                                "DD/MM HH:mm"
                              )
                            : "-"}
                          {locker.last_action && (
                            <div className="text-muted small">
                              {locker.last_action.includes("ERROR:")
                                ? locker.last_action.replace("ERROR: ", "")
                                : locker.last_action}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="d-flex gap-1 flex-wrap">
                          <div className="btn-group btn-group-sm">
                            <button
                              className="btn btn-success"
                              onClick={() =>
                                handleControl(locker.lock_id, "open")
                              }
                              disabled={controllingLocker === locker.lock_id}
                              title="Open (raise lock - Lock UP)"
                            >
                              <i className="bi bi-unlock"></i> Open
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={() =>
                                handleControl(locker.lock_id, "close")
                              }
                              disabled={controllingLocker === locker.lock_id}
                              title="Close (lower lock - Lock DOWN)"
                            >
                              <i className="bi bi-lock"></i> Close
                            </button>
                            <button
                              className="btn btn-warning"
                              onClick={() =>
                                handleControl(locker.lock_id, "stop")
                              }
                              disabled={controllingLocker === locker.lock_id}
                              title="Stop immediately"
                            >
                              <i className="bi bi-stop-circle"></i> Stop
                            </button>
                            <button
                              className="btn btn-info"
                              onClick={() =>
                                handleControl(locker.lock_id, "normal")
                              }
                              disabled={controllingLocker === locker.lock_id}
                              title="Normal (auto mode)"
                            >
                              <i className="bi bi-arrow-repeat"></i> Normal
                            </button>
                          </div>
                          {/* Business Flow Buttons */}
                          {!locker.occupied ? (
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() =>
                                handleCarEnter(locker.lock_id, locker)
                              }
                              disabled={locker.status !== "DOWN"}
                              title={
                                locker.status !== "DOWN"
                                  ? "Locker phải ở trạng thái DOWN để cho xe vào"
                                  : "Xe vào (Car Enter)"
                              }
                            >
                              <i className="bi bi-car-front"></i> Xe vào
                            </button>
                          ) : (
                            <>
                              {locker.status === "UP" ? (
                                <button
                                  className="btn btn-sm btn-warning"
                                  onClick={() =>
                                    handlePayment(locker.lock_id, locker)
                                  }
                                  title="Thanh toán (sẽ hạ locker xuống)"
                                >
                                  <i className="bi bi-credit-card"></i> Thanh
                                  toán
                                </button>
                              ) : (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() =>
                                    handleCarExit(locker.lock_id, locker)
                                  }
                                  disabled={locker.status !== "DOWN"}
                                  title="Xe ra (Car Exit)"
                                >
                                  <i className="bi bi-car-front-fill"></i> Xe ra
                                </button>
                              )}
                            </>
                          )}
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => {
                              if (configLocker === locker.lock_id) {
                                // Close config panel
                                setConfigLocker(null);
                                setConfigData({
                                  upProtect: "",
                                  downProtect: "",
                                  freeTime: "",
                                  warningTime: "",
                                  hourlyRate: "",
                                });
                              } else {
                                // Open config panel and load current values
                                setConfigLocker(locker.lock_id);
                                setConfigData({
                                  upProtect:
                                    locker.up_protect !== null &&
                                    locker.up_protect !== undefined
                                      ? String(locker.up_protect)
                                      : "",
                                  downProtect:
                                    locker.down_protect !== null &&
                                    locker.down_protect !== undefined
                                      ? String(locker.down_protect)
                                      : "",
                                  freeTime:
                                    locker.lock_free_time !== null &&
                                    locker.lock_free_time !== undefined
                                      ? String(locker.lock_free_time)
                                      : "",
                                  warningTime:
                                    locker.lock_warning_time !== null &&
                                    locker.lock_warning_time !== undefined
                                      ? String(locker.lock_warning_time)
                                      : "",
                                  hourlyRate:
                                    locker.hourly_rate !== null &&
                                    locker.hourly_rate !== undefined
                                      ? String(locker.hourly_rate)
                                      : "",
                                });
                              }
                            }}
                            title="Configuration"
                          >
                            <i className="bi bi-gear"></i>
                          </button>
                        </div>

                        {configLocker === locker.lock_id && (
                          <div className="card mt-2 p-2 bg-light">
                            <small className="d-block mb-2">
                              <strong>Configuration:</strong>
                            </small>
                            <div className="row g-2">
                              <div className="col-6">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  placeholder="Up Protect (20-95)"
                                  value={configData.upProtect}
                                  onChange={(e) =>
                                    setConfigData({
                                      ...configData,
                                      upProtect: e.target.value,
                                    })
                                  }
                                  min="20"
                                  max="95"
                                />
                              </div>
                              <div className="col-6">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  placeholder="Down Protect (20-95)"
                                  value={configData.downProtect}
                                  onChange={(e) =>
                                    setConfigData({
                                      ...configData,
                                      downProtect: e.target.value,
                                    })
                                  }
                                  min="20"
                                  max="95"
                                />
                              </div>
                              <div className="col-12">
                                <button
                                  className="btn btn-sm btn-primary w-100"
                                  onClick={() =>
                                    handleSetAttribute(locker.lock_id)
                                  }
                                >
                                  Set Protection
                                </button>
                              </div>
                              <div className="col-6">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  placeholder="Free Time (minutes)"
                                  value={configData.freeTime}
                                  onChange={(e) =>
                                    setConfigData({
                                      ...configData,
                                      freeTime: e.target.value,
                                    })
                                  }
                                  min="0"
                                />
                              </div>
                              <div className="col-6">
                                <button
                                  className="btn btn-sm btn-primary w-100"
                                  onClick={() =>
                                    handleSetFreeTime(locker.lock_id)
                                  }
                                >
                                  Set Free Time
                                </button>
                              </div>
                              <div className="col-6">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  placeholder="Warning Time (seconds)"
                                  value={configData.warningTime}
                                  onChange={(e) =>
                                    setConfigData({
                                      ...configData,
                                      warningTime: e.target.value,
                                    })
                                  }
                                  min="0"
                                />
                              </div>
                              <div className="col-6">
                                <button
                                  className="btn btn-sm btn-primary w-100"
                                  onClick={() =>
                                    handleSetWarningTime(locker.lock_id)
                                  }
                                >
                                  Set Warning
                                </button>
                              </div>
                              <div className="col-12">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  placeholder="Hourly Rate (VND/hour)"
                                  value={configData.hourlyRate}
                                  onChange={(e) =>
                                    setConfigData({
                                      ...configData,
                                      hourlyRate: e.target.value,
                                    })
                                  }
                                  min="0"
                                  step="1000"
                                />
                              </div>
                              <div className="col-12">
                                <button
                                  className="btn btn-sm btn-success w-100"
                                  onClick={() =>
                                    handleSetHourlyRate(locker.lock_id)
                                  }
                                >
                                  <i className="bi bi-currency-exchange me-1"></i>
                                  Set Hourly Rate
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      <PaymentModal
        locker={paymentModal.locker}
        show={paymentModal.show}
        onClose={() => setPaymentModal({ show: false, locker: null })}
        onConfirm={handleConfirmPayment}
      />
    </div>
  );
}
