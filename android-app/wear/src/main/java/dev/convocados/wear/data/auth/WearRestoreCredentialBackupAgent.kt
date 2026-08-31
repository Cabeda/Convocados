package dev.convocados.wear.data.auth

import android.app.backup.BackupDataInput
import android.app.backup.BackupDataOutput
import android.os.ParcelFileDescriptor
import android.app.backup.BackupAgent
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.runBlocking

@EntryPoint
@InstallIn(SingletonComponent::class)
interface WearRestoreCredentialEntryPoint {
    fun restoreCredentialCoordinator(): WearRestoreCredentialCoordinator
}

/** Runs Restore Credentials immediately after Android restores Wear app data. */
class WearRestoreCredentialBackupAgent : BackupAgent() {
    override fun onBackup(
        oldState: ParcelFileDescriptor,
        data: BackupDataOutput,
        newState: ParcelFileDescriptor,
    ) = Unit

    override fun onRestore(
        data: BackupDataInput,
        appVersionCode: Int,
        newState: ParcelFileDescriptor,
    ) = Unit

    override fun onRestoreFinished() {
        val context = applicationContext ?: return
        val entryPoint = EntryPointAccessors.fromApplication(
            context,
            WearRestoreCredentialEntryPoint::class.java,
        )
        runBlocking {
            entryPoint.restoreCredentialCoordinator().restoreIfNeeded(context)
        }
    }
}
