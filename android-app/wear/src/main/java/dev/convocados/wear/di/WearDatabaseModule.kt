package dev.convocados.wear.di

import android.content.Context
import androidx.room.Room
import androidx.work.WorkManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dev.convocados.wear.data.local.WearDatabase
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object WearDatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): WearDatabase =
        Room.databaseBuilder(context, WearDatabase::class.java, "convocados_wear.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provideGameDao(db: WearDatabase): WearGameDao = db.gameDao()

    @Provides
    fun provideHistoryDao(db: WearDatabase): WearHistoryDao = db.historyDao()

    @Provides
    fun providePendingScoreDao(db: WearDatabase): PendingScoreDao = db.pendingScoreDao()

    @Provides
    fun providePlayerDao(db: WearDatabase): WearPlayerDao = db.playerDao()

    @Provides
    fun providePendingRosterChangeDao(db: WearDatabase): PendingRosterChangeDao = db.pendingRosterChangeDao()

    @Provides
    @Singleton
    fun provideWorkManager(@ApplicationContext context: Context): WorkManager =
        WorkManager.getInstance(context)
}
