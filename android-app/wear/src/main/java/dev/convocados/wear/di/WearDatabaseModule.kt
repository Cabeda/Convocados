package dev.convocados.wear.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dev.convocados.wear.data.local.WearDatabase
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object WearDatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): WearDatabase =
        Room.databaseBuilder(context, WearDatabase::class.java, "convocados_wear.db")
            .build()

    @Provides
    fun provideGameDao(db: WearDatabase): WearGameDao = db.gameDao()

    @Provides
    fun provideHistoryDao(db: WearDatabase): WearHistoryDao = db.historyDao()

    @Provides
    fun providePendingScoreDao(db: WearDatabase): PendingScoreDao = db.pendingScoreDao()
}
