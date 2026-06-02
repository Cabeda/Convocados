package dev.convocados.wear.data.alarm

import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface AlarmBootEntryPoint {
    fun settingsStore(): GameSettingsStore
    fun alarmScheduler(): GameAlarmScheduler
}
