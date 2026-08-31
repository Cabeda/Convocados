package dev.convocados.wear.data.auth

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class WearRestoreCredentialBindings {
    @Binds
    @Singleton
    abstract fun bindRestoreCredentialGateway(
        gateway: ApiWearRestoreCredentialGateway,
    ): WearRestoreCredentialGateway
}
