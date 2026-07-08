// ponytail: MUI 9 made component types stricter — Typography/Stack/Box/Grid require
// explicit `component` prop when using system props or heading variants.
// This is a known issue (https://github.com/mui/material-ui/issues/48393).
// Override to restore permissive typing until MUI fixes upstream.
import type { TypographyProps } from "@mui/material/Typography";
import type { StackProps } from "@mui/material/Stack";
import type { BoxProps } from "@mui/material/Box";
import type { GridProps } from "@mui/material/Grid";

declare module "@mui/material/Typography" {
  export default function Typography(props: TypographyProps & Record<string, any>): JSX.Element | null;
}

declare module "@mui/material/Stack" {
  export default function Stack(props: StackProps & Record<string, any>): JSX.Element | null;
}

declare module "@mui/material/Box" {
  export default function Box(props: BoxProps & Record<string, any>): JSX.Element | null;
}

declare module "@mui/material/Grid" {
  export default function Grid(props: GridProps & Record<string, any>): JSX.Element | null;
}
