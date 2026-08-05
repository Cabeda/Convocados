import { Avatar, Link } from "@mui/material";
import Person2OutlinedIcon from "@mui/icons-material/Person2Outlined";

/** Round profile avatar for an account-linked player: image when set, else first-initial
 *  placeholder. Clickable (default) → the user's profile page. Anonymous players get a
 *  muted silhouette instead (AnonymousPlayerIcon). */
export function PlayerAvatar({
  userId, name, image, size = 22, clickable = true,
}: { userId?: string | null; name: string; image?: string | null; size?: number; clickable?: boolean }) {
  const avatar = (
    <Avatar
      alt={name}
      src={image ?? undefined}
      slotProps={{ img: { loading: "lazy" } }}
      sx={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.5)),
        bgcolor: "primary.main",
        color: "primary.contrastText",
        flexShrink: 0,
      }}
    >
      {name[0]?.toUpperCase()}
    </Avatar>
  );
  if (!userId || !clickable) return avatar;
  return (
    <Link href={`/users/${userId}`} sx={{ display: "inline-flex", textDecoration: "none", alignItems: "center" }} aria-label={name}>
      {avatar}
    </Link>
  );
}

/** Muted silhouette marking a player with no linked account. */
export function AnonymousPlayerIcon({ size = 20 }: { size?: number }) {
  return (
    <Person2OutlinedIcon sx={{ color: "text.disabled", width: size, height: size, flexShrink: 0 }} />
  );
}
