/* eslint-disable -- THROWAWAY prototype */
/** Variant A "Current": the REAL event page in an iframe (same origin → shared session cookie). */
export function PrototypeVariantA({ eventId }: { eventId: string }) {
  return (
    <iframe
      title="Current event page"
      src={`/events/${encodeURIComponent(eventId)}`}
      style={{ width: 390, height: 900, border: 0, display: "block" }}
    />
  );
}
