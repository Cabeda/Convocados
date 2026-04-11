package dev.convocados.ui

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UiEventManager @Inject constructor() {
    private val _events = MutableSharedFlow<UiEvent>()
    val events = _events.asSharedFlow()

    suspend fun showSnackbar(message: String) {
        _events.emit(UiEvent.ShowSnackbar(message))
    }
}

sealed class UiEvent {
    data class ShowSnackbar(val message: String) : UiEvent()
}
