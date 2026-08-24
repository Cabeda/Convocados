package dev.convocados.di

import android.content.Context
import androidx.room.Room
import androidx.work.WorkManager
import com.google.firebase.crashlytics.FirebaseCrashlytics
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dev.convocados.data.auth.OAuthTokenStorage
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.crash.CrashReporter
import dev.convocados.data.local.AppDatabase
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.UserDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "convocados.db"
        ).addMigrations(AppDatabase.MIGRATION_4_5).fallbackToDestructiveMigration().build()
    }

    @Provides
    fun provideEventDao(db: AppDatabase): EventDao = db.eventDao()

    @Provides
    fun provideEventDetailDao(db: AppDatabase): EventDetailDao = db.eventDetailDao()

    @Provides
    fun provideUserDao(db: AppDatabase): UserDao = db.userDao()

    @Provides
    @Singleton
    fun provideWorkManager(@ApplicationContext context: Context): WorkManager =
        WorkManager.getInstance(context)

    @Provides
    @Singleton
    fun provideOAuthTokenStorage(tokenStore: TokenStore): OAuthTokenStorage = tokenStore

    @Provides
    @Singleton
    fun provideCrashReporter(): CrashReporter {
        val instance = try {
            FirebaseCrashlytics.getInstance()
        } catch (_: Exception) {
            // Graceful degradation: if Crashlytics component is missing (e.g. R8 stripped
            // its registrar or FirebaseApp not yet initialized), don't crash the app.
            // The wrapper becomes a no-op; the real fix is the keep rule in proguard-rules.pro.
            null
        }
        return CrashReporter(instance)
    }
}
