import { useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@mui/material";
import { SignInModal } from "./SignInModal";

export interface SignInButtonProps extends Omit<ButtonProps, "children" | "href" | "onClick"> {
  /** Where the in-place modal should return to / consider "done" (e.g. the current path). */
  callbackURL: string;
  /** Called after a successful in-place sign-in so the caller can revalidate the session. */
  onSuccess?: () => void;
  children: ReactNode;
}

/**
 * The single sign-in affordance for the whole app.
 *
 * Renders a button that opens the in-place `SignInModal` instead of navigating
 * to `/auth/signin`, so signed-out users can log in without leaving the page.
 * Used by the navbar and by the "sign in to join this game" CTA on event pages
 * so both entry points behave identically.
 */
export function SignInButton({ callbackURL, onSuccess, children, ...buttonProps }: SignInButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <SignInModal
        open={open}
        onClose={() => setOpen(false)}
        callbackURL={callbackURL}
        onSuccess={() => {
          setOpen(false);
          onSuccess?.();
        }}
      />
    </>
  );
}
