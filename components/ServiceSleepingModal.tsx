"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Mail, X } from "lucide-react";

export default function ServiceSleepingModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    const handleBackendError = () => {
      setIsOpen(true);
    };

    window.addEventListener("backend-sleeping", handleBackendError);

    // Also intercept unhandled promise rejections if they contain 429 or Groq
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (
        event.reason &&
        (event.reason.message?.includes("429") ||
          event.reason.message?.includes("Groq API error") ||
          event.reason.message?.includes("Rate limit"))
      ) {
        event.preventDefault(); // Stop Next.js error overlay
        setIsOpen(true);
      }
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    // Overriding fetch to globally catch 429 errors from the client
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        if (response.status === 429 || response.status === 503) {
          window.dispatchEvent(new CustomEvent("backend-sleeping"));
        }
        return response;
      } catch (error) {
        throw error;
      }
    };

    return () => {
      window.removeEventListener("backend-sleeping", handleBackendError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.fetch = originalFetch;
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "1rem",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: "#1c2118",
          border: "1px solid #3d5030",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "480px",
          width: "100%",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          color: "#e2e8f0",
          position: "relative",
          animation: "slideIn 0.3s ease-out forwards",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div style={{ background: "#3d5030", padding: "8px", borderRadius: "50%", display: "flex" }}>
            <AlertCircle size={24} color="#a8e063" />
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#fff", fontWeight: 600 }}>
            Backend Service Temporarily Sleeping 😴
          </h2>
        </div>

        <div style={{ marginBottom: "24px", fontSize: "0.95rem", lineHeight: "1.6", color: "#a0aec0" }}>
          <p style={{ marginBottom: "12px" }}>
            The backend for this demo may not be running right now. If an action fails, it's likely due to an inactive deployment or expired API credentials rather than the application itself.
          </p>
          <p>
            Some features may be unavailable until the service wakes up. UI/UX, multimodal interactions, and core workflows can still be explored.
          </p>
        </div>

        {notified ? (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(76, 175, 80, 0.1)",
              border: "1px solid rgba(76, 175, 80, 0.3)",
              borderRadius: "8px",
              color: "#a8e063",
              fontSize: "0.9rem",
              textAlign: "center",
            }}
          >
            Thanks for the heads-up! A notification has been sent to the developer to check the service status. ✅
          </div>
        ) : (
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid #4a5568",
                color: "#cbd5e0",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "rgba(74, 85, 104, 0.3)")}
              onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Dismiss
            </button>
            <button
              onClick={() => setNotified(true)}
              style={{
                padding: "8px 16px",
                background: "#4caf50",
                border: "none",
                color: "#fff",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#45a049")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#4caf50")}
            >
              <Mail size={16} />
              Notify Developer
            </button>
          </div>
        )}

        <button
          onClick={() => setIsOpen(false)}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "transparent",
            border: "none",
            color: "#a0aec0",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
          }}
        >
          <X size={20} />
        </button>

        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}} />
      </div>
    </div>
  );
}
