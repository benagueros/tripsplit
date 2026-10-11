import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

// Ask the service worker to check for a new build when the tab becomes
// visible — tabs left open (or the installed PWA) otherwise keep serving
// the stale bundle until the next full reload.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  }
});

// Dev-only: #/demo opens a sample trip with no backend. Production builds
// drop this branch because import.meta.env.DEV is false there.
const DemoTrip = import.meta.env.DEV ? lazy(() => import("./dev/DemoTrip")) : null;
const showDemo = DemoTrip !== null && window.location.hash.startsWith("#/demo");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {showDemo && DemoTrip ? (
        <Suspense fallback={null}>
          <DemoTrip />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
