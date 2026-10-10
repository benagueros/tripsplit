import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

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
