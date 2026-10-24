/** Shown by the workspace shell while the Product event stream is down and a status was already loaded (D152). */
export function ReconnectingNotice() {
  return (
    <p className="reconnecting-notice" role="status">
      Reconnecting…
    </p>
  );
}
