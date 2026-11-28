import { Snackbar } from "@mui/material";

/** One quiet line at the bottom for what a header action just did. Announced politely, not as an alert. */
export function HeaderToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Snackbar
      open={!!message} message={message} autoHideDuration={3000} onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      slotProps={{ content: { role: "status" } }}
    />
  );
}
