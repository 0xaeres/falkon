/** Shown by the workspace shell while the Product event stream is down and a status was already loaded (D152). */
export function ReconnectingNotice() {
  return (
    <p
      className="m-0 bg-warning/10 px-4 py-1.5 text-center text-[0.8125rem] text-warning"
      role="status"
    >
      Reconnecting…
    </p>
  );
}
