package dev.convocados.wear.ui.theme

import androidx.compose.ui.graphics.Color

// "Tactile Minimalism, Nordic" — OLED-forward palette (Norm Architects inspired).
// True-black canvas; muted, warm, natural tones; bone text. No textures/gradients.
val Primary = Color(0xFF8C9A86)        // muted sage accent
val PrimaryDark = Color(0xFF33402F)    // sage, used for Team 1 tile
val OnPrimary = Color(0xFF14130F)      // near-black ink on accent
val Bg = Color(0xFF000000)             // true black (OLED + negative space)
val Surface = Color(0xFF15140F)        // warm near-black surface
val SurfaceHover = Color(0xFF201E18)   // one tonal elevation step (raised surfaces)
val Border = Color(0xFF2A2820)
val TextPrimary = Color(0xFFEAE4D7)    // bone
val TextSecondary = Color(0xFFC7C1B3)
val TextMuted = Color(0xFF9E988A)
val Error = Color(0xFFE6A8A0)          // muted clay-red
val Success = Color(0xFF8C9A86)
val Warning = Color(0xFFC9A36A)        // muted amber

// Team tiles (the tactile hero) — distinguished by hue + lightness, bone text on both.
val TeamOne = Color(0xFF33402F)        // muted sage
val TeamTwo = Color(0xFF4A3A2C)        // warm clay
val OnTeam = Color(0xFFEAE4D7)
