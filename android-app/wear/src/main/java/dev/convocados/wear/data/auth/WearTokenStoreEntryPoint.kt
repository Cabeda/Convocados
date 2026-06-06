package dev.convocados.wear.data.auth

import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Exposes the singleton [WearTokenStore] so instrumentation can drive the app's live auth state. */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface WearTokenStoreEntryPoint {
    fun tokenStore(): WearTokenStore
}
