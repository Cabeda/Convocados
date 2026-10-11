package dev.convocados.wear.ui.screen.mvp

import androidx.compose.foundation.layout.Box

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.ListHeaderDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import dev.convocados.wear.R
import dev.convocados.wear.ui.roundListInset
import dev.convocados.wear.ui.roundBezelClip

/** Marks the loading row; the spinner itself carries no semantics. */
const val MVP_LOADING_ROW = "mvp_voting_loading_row"

@Composable
fun MvpVotingScreen(
    viewModel: MvpVotingViewModel,
    eventId: String,
    historyId: String,
) {
    val state by viewModel.uiState.collectAsState()
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    LaunchedEffect(eventId, historyId) {
        viewModel.load(eventId, historyId)
    }

    Box(
        Modifier
            .fillMaxSize()
            .roundBezelClip(),
    ) {
        ScreenScaffold(scrollState = columnState) { contentPadding ->
            TransformingLazyColumn(
                state = columnState,
                contentPadding = contentPadding,
                modifier = Modifier.fillMaxSize(),
            ) {
                item {
                    ListHeader(
                        modifier = Modifier
                            .fillMaxWidth()
                            .transformedHeight(this, transformationSpec)
                            .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                        transformation = SurfaceTransformation(transformationSpec),
                    ) {
                        Text(
                            text = stringResource(R.string.mvp_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                           }
    }

                when {
                    state.isLoading -> item {
                        Row(
                            modifier = Modifier.fillMaxWidth().roundListInset().testTag(MVP_LOADING_ROW),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                    state.error != null -> item {
                        Column(
                            modifier = Modifier.fillMaxWidth().roundListInset(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = state.error.orEmpty(),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.error,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            CompactButton(onClick = { viewModel.load(eventId, historyId) }) {
                                Text(stringResource(R.string.mvp_retry))
                            }
                        }
                    }
                    state.response?.isVotingOpen == true && state.response?.hasVoted != null -> {
                        item {
                            Column(modifier = Modifier.fillMaxWidth().roundListInset()) {
                                Text(
                                    text = stringResource(R.string.mvp_vote_prompt),
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (state.response?.hasVoted == true) {
                                    Text(
                                        text = stringResource(R.string.mvp_vote_recorded),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                            }
                        }
                        items(
                            items = state.response?.participants.orEmpty(),
                            key = { it.playerId },
                        ) { participant ->
                            Button(
                                onClick = { viewModel.vote(participant.playerId) },
                                enabled = !state.isSubmitting,
                                modifier = Modifier.fillMaxWidth().roundListInset(),
                                label = {
                                    Text(
                                        text = participant.playerName,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                },
                                secondaryLabel = {
                                    Text(
                                        text = stringResource(R.string.mvp_votes, participant.voteCount),
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                },
                            )
                        }
                    }
                    state.response?.isVotingOpen == true -> item {
                        Text(
                            text = stringResource(R.string.mvp_not_eligible),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.fillMaxWidth().roundListInset(),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    else -> {
                        item {
                            Text(
                                text = stringResource(R.string.mvp_voting_closed),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth().roundListInset(),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        val winners = state.response?.mvp.orEmpty()
                        if (winners.isEmpty()) {
                            item {
                                Text(
                                    text = stringResource(R.string.mvp_no_votes),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.fillMaxWidth().roundListInset(),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        } else {
                            items(winners, key = { it.playerId }) { winner ->
                                Button(
                                    onClick = {},
                                    enabled = false,
                                    modifier = Modifier.fillMaxWidth().roundListInset(),
                                    label = {
                                        Text(
                                            text = winner.playerName,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    },
                                    secondaryLabel = {
                                        Text(
                                            text = stringResource(R.string.mvp_votes, winner.voteCount),
                                            style = MaterialTheme.typography.labelSmall,
                                        )
                                    },
                                )
                            }
                        }
                    }
                }
            }
    
 }
    }
}
