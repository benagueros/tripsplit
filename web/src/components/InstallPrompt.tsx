import { useEffect, useState } from "react";
import Icon from "./Icon";

// beforeinstallprompt is a real browser event but isn't in TS's DOM lib.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * PWA install banner. Shows only when the browser fires beforeinstallprompt
 * (Chromium/Android — iOS has no programmatic install prompt) and the app
 * isn't already installed. Dismissal is sticky per device.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("tripsplit_install_dismissed") === "1";
    } catch {
      return true;
    }
  });
  const [installed] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // hold it so we can show our own banner
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || installed || !deferred) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem("tripsplit_install_dismissed", "1");
    } catch {
      /* private mode — banner just shows again next visit */
    }
  };

  const install = async () => {
    try {
      await deferred.prompt();
    } finally {
      dismiss();
    }
  };

  return (
    <div className="card">
      <div className="row">
        <span className="tile"><Icon name="download" size={22} /></span>
        <div className="grow">
          <b>Install TripSplit</b>
          <div className="muted">Add it to your home screen for one-tap access on the next trip.</div>
        </div>
      </div>
      <div className="btnrow">
        <button className="btn ghost small" onClick={dismiss}>
          Not now
        </button>
        <button className="btn small" onClick={install}>
          Install
        </button>
      </div>
    </div>
  );
}
