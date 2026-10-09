/** compact: the wordmark hides on narrow screens (see .logo.compact). */
export default function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? "logo compact" : "logo"}>
      <img src="/icon-192.png" alt="TripSplit logo" />
      <span className="wm">
        trip<em>split</em>
      </span>
    </div>
  );
}
