package dev.convocados.wear.ui.theme

import androidx.compose.ui.graphics.Color

// "Tactile Minimalism, Nordic" — OLED-forward palette (Norm Architects inspired).
// True-black canvas; muted, warm, natural tones; bone text. No textures/gradients.

// Primary (sage)
val Primary = Color(0xFF8C9A86)        // muted sage accent
val PrimaryDim = Color(0xFF33402F)     // dimmed sage (press/emphasis-soft states)
val OnPrimary = Color(0xFF14130F)      // near-black ink on accent

// Secondary (muted olive-grey — neutral accent)
val Secondary = Color(0xFF7E8272)
val SecondaryDim = Color(0xFF565A4D)
val OnSecondary = Color(0xFF14130F)

// Tertiary (warm clay)
val Tertiary = Color(0xFFA98A6F)
val TertiaryDim = Color(0xFF7A5F4B)
val OnTertiary = Color(0xFF14130F)

// Surfaces (OLED near-black stack)
val Bg = Color(0xFF000000)             // true black (OLED + negative space)
val Surface = Color(0xFF15140F)        // warm near-black surface
val SurfaceHover = Color(0xFF201E18)   // one tonal elevation step
val SurfaceHigh = Color(0xFF2A2820)    // two tonal steps
val Border = Color(0xFF2A2820)
val OutlineVariant = Color(0xFF3B3830)

// Text
val TextPrimary = Color(0xFFEAE4D7)    // bone
val TextSecondary = Color(0xFFC7C1B3)
val TextMuted = Color(0xFF9E988A)

// Semantic
val Error = Color(0xFFE6A8A0)          // muted clay-red
val ErrorDim = Color(0xFFC98C84)
val ErrorContainer = Color(0xFF3A2B29)
val OnErrorContainer = Color(0xFFE6A8A0)
val Success = Color(0xFF8C9A86)
val Warning = Color(0xFFC9A36A)        // muted amber

// Team tiles (the tactile hero) — distinguished by hue + lightness, bone text on both.
val TeamOne = Color(0xFF33402F)        // muted sage
val TeamTwo = Color(0xFF4A3A2C)        // warm clay
val OnTeam = Color(0xFFEAE4D7)
