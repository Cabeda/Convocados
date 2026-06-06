# Replace implicit "joined" dashboard visibility with explicit EventFollow table

The "My games" dashboard showed events where the user had a linked `Player` record (`Player.userId` set). This conflated participation with dashboard visibility — a user who was auto-linked by the owner or added as an admin had no dashboard entry. We introduced an `EventFollow` table that separates "I want to see this on my dashboard" (follow) from "I play in this game" (joined/participation). The profile page still shows participation.

Auto-follow triggers only on user-initiated actions (Quick Join, Claim Player). Auto-link and owner/admin-add do not follow. Self-removal and event-archiving auto-unfollow. Admins get a separate implicit query — they see events they admin without needing an explicit follow record.
