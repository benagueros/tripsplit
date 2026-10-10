import React from "react";

/**
 * Catches render crashes (e.g. a degenerate receipt breaking the Settle
 * screen) so one bad expense can never whitescreen the whole app.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("TripSplit render crash:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen">
          <div className="card center" style={{ alignItems: "center", marginTop: 40 }}>
            <div style={{ fontSize: 40, lineHeight: 1 }}>🫠</div>
            <h1>Something went wrong</h1>
            <p className="muted">
              This trip has data the app can't display right now. Try editing
              the latest receipt, or rejoin with the trip link.
            </p>
            <button
              className="btn"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
