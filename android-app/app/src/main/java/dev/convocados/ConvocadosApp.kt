package dev.convocados

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class ConvocadosApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            "default",
            "Game notifications",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Player activity, game reminders, and event updates"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
