import { useEffect, useState } from "react";

/** The browser's root text size at which "large text" starts: 150% of the usual 16px. */
const LARGE_PX = 24;

/**
 * Has this person asked for much bigger text (a phone's font size, a browser's text zoom)? Then a title is shown
 * whole rather than cut at three lines, because for them three lines is not much of a title.
 */
export function useLargeText(): boolean {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    const read = () => setLarge(parseFloat(getComputedStyle(document.documentElement).fontSize) >= LARGE_PX);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return large;
}
