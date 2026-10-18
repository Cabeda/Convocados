package dev.convocados.util

object Money {
    private val symbols = mapOf(
        "EUR" to "€",
        "USD" to "$",
        "GBP" to "£",
        "BRL" to "R$",
    )

    /** Canonical money format: two decimals, then the symbol, no space (e.g. `50.00€`). */
    fun formatMoney(cents: Int, currency: String?): String {
        val code = currency?.trim()?.uppercase().orEmpty().ifBlank { "EUR" }
        val symbol = symbols[code] ?: code
        return "%.2f%s".format(cents / 100.0, symbol)
    }

    /** Convenience for legacy float amounts. */
    fun formatMoney(amount: Double, currency: String?): String =
        formatMoney(kotlin.math.round(amount * 100).toInt(), currency)

    fun toCents(amount: Double): Int = kotlin.math.round(amount * 100).toInt()
}

/** Top-level alias mirroring `src/lib/money.ts`. */
fun formatMoney(cents: Int, currency: String?): String = Money.formatMoney(cents, currency)

/** Top-level alias for legacy float amounts. */
fun formatMoney(amount: Double, currency: String?): String = Money.formatMoney(amount, currency)
