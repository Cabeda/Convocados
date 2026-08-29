package dev.convocados.designsystem

/**
 * Platform-neutral semantic states shared by phone and Wear themes.
 * Rendered colors, typography, and component scales remain platform-specific.
 */
enum class ExpressiveSemanticRole {
    Success,
    Warning,
    Live,
    Offline,
    Pending,
    Payment,
    Error,
}

object ExpressiveSemanticContract {
    val requiredRoles: Set<ExpressiveSemanticRole> = ExpressiveSemanticRole.entries.toSet()

    val brandPreservedRoles: Set<ExpressiveSemanticRole> = requiredRoles
}

enum class ExpressiveMotion {
    Expressive,
    Reduced,
}

object ExpressiveMotionPolicy {
    fun fromAnimatorScale(animatorScale: Float): ExpressiveMotion =
        if (animatorScale <= 0f) ExpressiveMotion.Reduced else ExpressiveMotion.Expressive
}
