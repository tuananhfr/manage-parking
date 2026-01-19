import React, { useState } from "react";


const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const LoginPage = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);


  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Đăng nhập thất bại");
      }

      // Save token and user info to localStorage
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Trigger auth refresh in App.jsx
      if (onLoginSuccess) {
        onLoginSuccess();
      }

      // Do NOT navigate manually here.
      // App.jsx will automatically redirect to '/' when user state is updated.
    } catch (err) {
      setError(err.message || "Đăng nhập thất bại. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#212529", // bg-dark color
        color: "#f8f9fa", // text-light
      }}
    >
      <div
        style={{
          background: "#343a40", // slightly lighter dark
          borderRadius: "16px",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          padding: "48px 40px",
          width: "100%",
          maxWidth: "420px",
          border: "1px solid #495057",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            marginBottom: "8px",
            fontSize: "28px",
            fontWeight: "700",
            color: "#f8f9fa",
          }}
        >
          Đăng nhập
        </h1>
        <p
          style={{
            textAlign: "center",
            marginBottom: "32px",
            color: "#adb5bd",
            fontSize: "14px",
          }}
        >
          Hệ thống quản lý bãi xe
        </p>

        {error && (
          <div
            style={{
              background: "rgba(220, 53, 69, 0.2)",
              color: "#ea868f",
              padding: "12px 16px",
              borderRadius: "8px",
              marginBottom: "24px",
              fontSize: "14px",
              border: "1px solid #842029",
            }}
          >
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="username"
              style={{
                display: "block",
                marginBottom: "8px",
                fontSize: "14px",
                fontWeight: "600",
                color: "#ced4da",
              }}
            >
              Tên đăng nhập
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin hoặc guard"
              required
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "#212529",
                border: "1px solid #495057",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#f8f9fa",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#0d6efd")}
              onBlur={(e) => (e.target.style.borderColor = "#495057")}
            />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: "8px",
                fontSize: "14px",
                fontWeight: "600",
                color: "#ced4da",
              }}
            >
              Mật khẩu
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                required
                style={{
                  width: "100%",
                  padding: "12px 48px 12px 16px",
                  background: "#212529",
                  border: "1px solid #495057",
                  borderRadius: "8px",
                  fontSize: "14px",
                  color: "#f8f9fa",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#0d6efd")}
                onBlur={(e) => (e.target.style.borderColor = "#495057")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#adb5bd",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <i
                  className={`bi ${
                    showPassword ? "bi-eye-slash-fill" : "bi-eye-fill"
                  }`}
                  style={{ fontSize: "18px" }}
                ></i>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              background: loading ? "#6c757d" : "#0d6efd", // primary color
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.backgroundColor = "#0b5ed7";
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.target.style.backgroundColor = "#0d6efd";
              }
            }}
          >
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm me-2"></span>
                Đang đăng nhập...
              </>
            ) : (
              "Đăng nhập"
            )}
          </button>
        </form>

        <div
          style={{
            marginTop: "24px",
            padding: "16px",
            background: "rgba(255, 255, 255, 0.05)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#adb5bd",
            border: "1px solid #495057",
          }}
        >
          <strong>Thông tin đăng nhập mặc định:</strong>
          <br />
          Quản lý: <code>admin / 123456 </code>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
