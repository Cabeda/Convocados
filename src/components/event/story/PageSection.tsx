import type { ComponentProps, ReactNode } from "react";
import { Box } from "@mui/material";

/**
 * The page's one rhythm. The sections of the event page sit 24px apart (the page's own gap); a section that
 * opens a new part of the story ("Next game", "Play again?") sits 32px from the one before it ("major"), and a
 * section inside another ("Teams" in the Next game block) sits 32px under what is above it ("nested").
 * Every section is a named region: pass `aria-labelledby` (a heading inside it) or `aria-label`.
 */
export type SectionGap = "page" | "major" | "nested";

export const SECTION_SPACING: Record<SectionGap, number> = { page: 0, major: 1, nested: 4 };

type Props = Omit<ComponentProps<typeof Box>, "component" | "children"> & { gap?: SectionGap; children: ReactNode };

export function PageSection({ gap = "page", sx, children, ...rest }: Props) {
  return (
    <Box component="section" data-gap={gap} sx={{ mt: SECTION_SPACING[gap], maxWidth: "32rem", ...(sx as object) }} {...rest}>
      {children}
    </Box>
  );
}
