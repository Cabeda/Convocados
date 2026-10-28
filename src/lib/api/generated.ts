// @generated — do not edit; run pnpm generate:api-client

/**
 * Every operation in the API description, keyed "METHOD /path".
 * Response shapes are `unknown` until the description declares a schema.
 */
export interface ApiOperations {
  "GET /api/health": Record<string, never>;
  "GET /api/openapi.json": Record<string, never>;
  "GET /api/events": Record<string, never>;
  "POST /api/events": {
    body: {
      title: string;
      location?: string;
      city?: string;
      dateTime: string;
      timezone?: string;
      maxPlayers?: number;
      sport?: string;
      teamOneName?: string;
      teamTwoName?: string;
      isRecurring?: boolean;
      recurrenceRule?: string;
      recurrenceFreq?: string | null;
      recurrenceInterval?: number | null;
      recurrenceByDay?: string | null;
      latitude?: number;
      longitude?: number;
    };
  };
  "GET /api/events/public": {
    query: {
      sport?: string;
      hasSpots?: boolean;
      cursor?: string;
    };
  };
  "GET /api/events/{id}": {
    params: {
      id: string;
    };
    query: {
      inviteToken?: string;
    };
  };
  "PUT /api/events/{id}/title": {
    params: {
      id: string;
    };
    body: {
      title?: string;
    };
  };
  "PUT /api/events/{id}/location": {
    params: {
      id: string;
    };
    body: {
      location?: string;
    };
  };
  "PUT /api/events/{id}/sport": {
    params: {
      id: string;
    };
    body: {
      sport?: string;
    };
  };
  "PUT /api/events/{id}/recurrence": {
    params: {
      id: string;
    };
    body: {
      isRecurring: boolean;
      recurrenceFreq?: "daily" | "weekly" | "monthly" | "yearly";
      recurrenceInterval?: number;
      recurrenceByDay?: string;
    };
  };
  "PUT /api/events/{id}/visibility": {
    params: {
      id: string;
    };
    body: {
      isPublic?: boolean;
    };
  };
  "PUT /api/events/{id}/balanced": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/show-competitive-data": {
    params: {
      id: string;
    };
    body: {
      showCompetitiveData?: boolean;
    };
  };
  "PUT /api/events/{id}/manual-rating": {
    params: {
      id: string;
    };
    body: {
      allowManualRating?: boolean;
    };
  };
  "PUT /api/events/{id}/mvp-enabled": {
    params: {
      id: string;
    };
    body: {
      mvpEnabled?: boolean;
    };
  };
  "PUT /api/events/{id}/mvp-elo-enabled": {
    params: {
      id: string;
    };
    body: {
      mvpEloEnabled?: boolean;
    };
  };
  "PUT /api/events/{id}/duration": {
    params: {
      id: string;
    };
    body: {
      durationMinutes?: number;
    };
  };
  "PUT /api/events/{id}/datetime": {
    params: {
      id: string;
    };
    body: {
      dateTime?: string;
      timezone?: string;
    };
  };
  "PUT /api/events/{id}/elo": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/competition": {
    params: {
      id: string;
    };
    body: {
      enabled?: boolean;
      rankDecayEnabled?: boolean;
      inactiveRankBehavior?: "freeze" | "reset";
    };
  };
  "GET /api/events/{id}/seasons": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/seasons": {
    params: {
      id: string;
    };
    body: {
      name: string;
      registrationOpensAt: string;
      registrationClosesAt: string;
    };
  };
  "GET /api/events/{id}/seasons/{seasonId}/rank": {
    params: {
      id: string;
      seasonId: string;
    };
  };
  "GET /api/events/{id}/seasons/{seasonId}": {
    params: {
      id: string;
      seasonId: string;
    };
    query: {
      crewInviteToken?: string;
    };
  };
  "PATCH /api/events/{id}/seasons/{seasonId}": {
    params: {
      id: string;
      seasonId: string;
    };
    body: {
      action: "update" | "activate" | "complete" | "cancel" | "reopen";
      name?: string;
      registrationOpensAt?: string;
      registrationClosesAt?: string;
      reason?: string;
    };
  };
  "POST /api/events/{id}/seasons/{seasonId}/membership": {
    params: {
      id: string;
      seasonId: string;
    };
    body: {
      eventPlayerId: string;
    };
  };
  "DELETE /api/events/{id}/seasons/{seasonId}/membership": {
    params: {
      id: string;
      seasonId: string;
    };
  };
  "POST /api/events/{id}/seasons/{seasonId}/memberships": {
    params: {
      id: string;
      seasonId: string;
    };
    body: {
      eventPlayerId: string;
      crewId?: string;
    };
  };
  "POST /api/events/{id}/seasons/{seasonId}/memberships/bulk": {
    params: {
      id: string;
      seasonId: string;
    };
    body: Record<string, unknown>;
  };
  "GET /api/events/{id}/seasons/{seasonId}/memberships/candidates": {
    params: {
      id: string;
      seasonId: string;
    };
  };
  "DELETE /api/events/{id}/seasons/{seasonId}/memberships/{membershipId}": {
    params: {
      id: string;
      seasonId: string;
      membershipId: string;
    };
  };
  "GET /api/events/{id}/seasons/{seasonId}/crew-proposals": {
    params: {
      id: string;
      seasonId: string;
    };
  };
  "POST /api/events/{id}/seasons/{seasonId}/crew-proposals": {
    params: {
      id: string;
      seasonId: string;
    };
    body: {
      action?: "claim-invite" | "invite" | "captain" | "add" | "remove";
      token?: string;
      email?: string;
      name?: string;
      crewId?: string;
      targetCrewId?: string;
      membershipId?: string;
      membershipIds?: string[];
      members?: { membershipId?: string; userId?: string }[];
    };
  };
  "PATCH /api/events/{id}/seasons/{seasonId}/crew-proposals/{proposalId}": {
    params: {
      id: string;
      seasonId: string;
      proposalId: string;
    };
    body: {
      decision: "approve" | "reject" | "accept";
      rejectionReason?: string;
    };
  };
  "POST /api/events/{id}/seasons/{seasonId}/crews": {
    params: {
      id: string;
      seasonId: string;
    };
    body: {
      crews: { name: string; membershipIds: string[] }[];
    };
  };
  "POST /api/events/{id}/seasons/{seasonId}/crews/recommend": {
    params: {
      id: string;
      seasonId: string;
    };
    body: {
      crewCount: number;
    };
  };
  "DELETE /api/events/{id}/seasons/{seasonId}/crews/{crewId}": {
    params: {
      id: string;
      seasonId: string;
      crewId: string;
    };
  };
  "PUT /api/events/{id}/hide-elo-in-teams": {
    params: {
      id: string;
    };
    body: {
      hideEloInTeams?: boolean;
    };
  };
  "PUT /api/events/{id}/split-costs": {
    params: {
      id: string;
    };
    body: {
      splitCostsEnabled?: boolean;
    };
  };
  "PUT /api/events/{id}/positions-enabled": {
    params: {
      id: string;
    };
    body: {
      positionsEnabled?: boolean;
    };
  };
  "GET /api/events/{id}/cost": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/cost": {
    params: {
      id: string;
    };
    body: {
      totalAmount: number;
      currency?: string;
      scope?: "this_game" | "all_future";
      paymentDetails?: string | null;
      paymentMethods?: unknown;
      monthlyEnabled?: boolean;
      monthlyFeeCents?: number | null;
      monthlyGamesCovered?: number | null;
      dropInSurchargeCents?: number | null;
    };
  };
  "PUT /api/events/{id}/cost/override": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/follow": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/follow": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/follow": {
    params: {
      id: string;
    };
    body: {
      mutePlayerActivity?: boolean | null;
      muteReminders?: boolean | null;
      mutePostGame?: boolean | null;
      muteEventDetails?: boolean | null;
    };
  };
  "DELETE /api/events/{id}/follow": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/invitation-opt-out": {
    params: {
      id: string;
    };
    body: {
      optOut: boolean;
    };
  };
  "GET /api/events/{id}/rsvp": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/rsvp": {
    params: {
      id: string;
    };
    body: {
      status?: "yes" | "no" | "maybe";
    };
  };
  "POST /api/events/{id}/leave": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/no-show": {
    params: {
      id: string;
    };
    body: {
      gameId?: string;
      eventPlayerId?: string;
      noShow?: boolean;
    };
  };
  "GET /api/events/{id}/access": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/access": {
    params: {
      id: string;
    };
    body: {
      password?: string | null;
    };
  };
  "GET /api/events/{id}/access/invites": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/access/invites": {
    params: {
      id: string;
    };
    body: {
      email: string;
    };
  };
  "DELETE /api/events/{id}/access/invites": {
    params: {
      id: string;
    };
    body: {
      userId: string;
    };
  };
  "POST /api/events/{id}/access/verify": {
    params: {
      id: string;
    };
    body: {
      password: string;
    };
  };
  "GET /api/events/{id}/admins": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/admins": {
    params: {
      id: string;
    };
    body: {
      userId?: string;
      email?: string;
    };
  };
  "DELETE /api/events/{id}/admins": {
    params: {
      id: string;
    };
    body: {
      userId: string;
    };
  };
  "GET /api/events/{id}/admins/candidates": {
    params: {
      id: string;
    };
    query: {
      q?: string;
    };
  };
  "PUT /api/events/{id}/archive": {
    params: {
      id: string;
    };
    body: {
      archive: boolean;
    };
  };
  "GET /api/events/{id}/post-game-status": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/max-players": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/priority": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/priority": {
    params: {
      id: string;
    };
    body: {
      priorityEnabled?: boolean;
      priorityThreshold?: number;
      priorityWindow?: number;
      priorityMaxPercent?: number;
      priorityDeadlineHours?: number;
      priorityMinGames?: number;
    };
  };
  "DELETE /api/events/{id}/priority/{userId}": {
    params: {
      id: string;
      userId: string;
    };
  };
  "POST /api/events/{id}/priority/confirm": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/priority/decline": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/priority/opt-in": {
    params: {
      id: string;
    };
    body: Record<string, unknown>;
  };
  "PUT /api/events/{id}/priority/opt-out": {
    params: {
      id: string;
    };
    body: Record<string, unknown>;
  };
  "GET /api/events/{id}/notification-defaults": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/notification-defaults": {
    params: {
      id: string;
    };
    body: {
      mutePlayerActivity?: boolean | null;
      muteReminders?: boolean | null;
      mutePostGame?: boolean | null;
      muteEventDetails?: boolean | null;
    };
  };
  "GET /api/events/{id}/attendance": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/payments": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/payments": {
    params: {
      id: string;
    };
    body: {
      playerName?: string;
      status?: "pending" | "sent" | "paid";
    };
  };
  "PUT /api/events/{id}/payments/bulk": {
    params: {
      id: string;
    };
  };
  "PATCH /api/events/{id}/payments/config": {
    params: {
      id: string;
    };
    body: {
      gameId?: string;
      mode: "tracked" | "untracked";
      payerEventPlayerId?: string;
      payerExternalName?: string;
    };
  };
  "GET /api/events/{id}/payments/settlement": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/payments/settlement": {
    params: {
      id: string;
    };
    body: {
      gameId: string;
      eventPlayerId: string;
    };
  };
  "DELETE /api/events/{id}/payments/settlement": {
    params: {
      id: string;
    };
    body: {
      gameId: string;
      eventPlayerId: string;
    };
  };
  "PUT /api/events/{id}/payments/settlement/bulk": {
    params: {
      id: string;
    };
    body: {
      gameId: string;
    };
  };
  "POST /api/events/{id}/payments/settlement/self-report": {
    params: {
      id: string;
    };
    body: {
      gameId: string;
      eventPlayerId: string;
    };
  };
  "POST /api/events/{id}/payments/payer-check-in/mark-all-paid": {
    params: {
      id: string;
    };
    body: {
      gameId: string;
    };
  };
  "POST /api/events/{id}/payments/payer-check-in/snooze": {
    params: {
      id: string;
    };
    body: {
      gameId: string;
    };
  };
  "GET /api/events/{id}/settle": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/settle/extras": {
    params: {
      id: string;
    };
    body: {
      amountCents: number;
      label: string;
    };
  };
  "POST /api/events/{id}/settle/subscriptions": {
    params: {
      id: string;
    };
    body: {
      userId: string;
      windowStart?: string;
    };
  };
  "DELETE /api/events/{id}/settle/subscriptions/{subId}": {
    params: {
      id: string;
      subId: string;
    };
  };
  "GET /api/events/{id}/balance": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/log": {
    params: {
      id: string;
    };
    query: {
      cursor?: string;
    };
  };
  "POST /api/events/{id}/history/{historyId}/mvp-vote": {
    params: {
      id: string;
      historyId: string;
    };
    body: {
      votedForPlayerId?: string;
      votedForName?: string;
    };
  };
  "GET /api/events/{id}/history/{historyId}/mvp": {
    params: {
      id: string;
      historyId: string;
    };
  };
  "GET /api/events/{id}/history/{historyId}/match-events": {
    params: {
      id: string;
      historyId: string;
    };
  };
  "POST /api/events/{id}/history/{historyId}/match-events": {
    params: {
      id: string;
      historyId: string;
    };
    body: {
      type: "goal" | "assist";
      team?: "one" | "two";
      minute?: unknown;
      count?: number;
      scorerEventPlayerId?: string;
      scorerName?: string;
      assistEventPlayerId?: string;
      assistName?: unknown;
      ownGoal?: boolean;
      penalty?: boolean;
    };
  };
  "DELETE /api/events/{id}/history/{historyId}/match-events/{matchEventId}": {
    params: {
      id: string;
      historyId: string;
      matchEventId: string;
    };
  };
  "GET /api/events/{id}/match-stats": {
    params: {
      id: string;
    };
  };
  "GET /api/users/{id}/stats": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/team-names": {
    params: {
      id: string;
    };
    body: {
      teamOneName: string;
      teamTwoName: string;
    };
  };
  "POST /api/events/{id}/claim": {
    params: {
      id: string;
    };
  };
  "DELETE /api/events/{id}/claim": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/cancel": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/transfer": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/adopt": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/status": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/players": {
    params: {
      id: string;
    };
    body: {
      name: string;
      linkToAccount?: boolean;
      email?: string;
      position?: string;
    };
  };
  "PATCH /api/events/{id}/players": {
    params: {
      id: string;
    };
    body: {
      name: string;
      position: string | null;
    };
  };
  "DELETE /api/events/{id}/players": {
    params: {
      id: string;
    };
    body: {
      playerId: string;
    };
  };
  "PUT /api/events/{id}/reorder-players": {
    params: {
      id: string;
    };
    body: {
      playerIds: string[];
    };
  };
  "POST /api/events/{id}/reset-player-order": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/claim-player": {
    params: {
      id: string;
    };
    body: {
      playerId: string;
    };
  };
  "POST /api/events/{id}/merge-player": {
    params: {
      id: string;
    };
    body: {
      sourceName: string;
      targetName: string;
    };
  };
  "POST /api/events/{id}/undo-remove": {
    params: {
      id: string;
    };
    body: {
      name: string;
      order: number;
      userId: string | null;
      removedAt: number;
    };
  };
  "GET /api/events/{id}/known-players": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/teams": {
    params: {
      id: string;
    };
  };
  "PUT /api/events/{id}/teams": {
    params: {
      id: string;
    };
    body: {
      matches: { team: string; formation?: string | null; players: { name: string; order: number; slot?: number | null }[] }[];
    };
  };
  "PATCH /api/events/{id}/teams": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/randomize": {
    params: {
      id: string;
    };
    query: {
      balanced?: boolean;
    };
  };
  "GET /api/events/{id}/history": {
    params: {
      id: string;
    };
    query: {
      cursor?: string;
    };
  };
  "POST /api/events/{id}/history": {
    params: {
      id: string;
    };
    body: {
      dateTime: string;
      teamOneName: string;
      teamTwoName: string;
      scoreOne?: number;
      scoreTwo?: number;
      scoreSets?: unknown;
      teamsSnapshot: unknown;
    };
  };
  "GET /api/events/{id}/history/{historyId}": {
    params: {
      id: string;
      historyId: string;
    };
  };
  "PATCH /api/events/{id}/history/{historyId}": {
    params: {
      id: string;
      historyId: string;
    };
    body: {
      scoreOne?: unknown;
      scoreTwo?: unknown;
      scoreSets?: unknown;
      status?: "played" | "cancelled" | "upcoming";
      isFriendly?: boolean;
      teamsSnapshot?: unknown;
      paymentsSnapshot?: unknown;
      costTotalAmount?: number;
      costCurrency?: string;
    };
  };
  "DELETE /api/events/{id}/history/{historyId}": {
    params: {
      id: string;
      historyId: string;
    };
  };
  "POST /api/events/{id}/history/{historyId}/approve-elo": {
    params: {
      id: string;
      historyId: string;
    };
  };
  "GET /api/events/{id}/ratings": {
    params: {
      id: string;
    };
    query: {
      limit?: number;
      cursor?: string;
    };
  };
  "PATCH /api/events/{id}/ratings": {
    params: {
      id: string;
    };
    body: {
      name: string;
      initialRating: number;
    };
  };
  "POST /api/events/{id}/ratings/recalculate": {
    params: {
      id: string;
    };
  };
  "DELETE /api/events/{id}/purge-player": {
    params: {
      id: string;
    };
    body: {
      name: string;
    };
  };
  "GET /api/events/{id}/calendar": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/calendar.ics": {
    params: {
      id: string;
    };
    query: {
      token: string;
    };
  };
  "GET /api/users/{id}/calendar.ics": {
    params: {
      id: string;
    };
    query: {
      token: string;
    };
  };
  "POST /api/events/{id}/push": {
    params: {
      id: string;
    };
  };
  "DELETE /api/events/{id}/push": {
    params: {
      id: string;
    };
  };
  "POST /api/push/subscribe": {
    body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      locale?: string;
    };
  };
  "DELETE /api/push/subscribe": {
    body: {
      endpoint: string;
    };
  };
  "GET /api/push/vapid-public-key": Record<string, never>;
  "POST /api/push/test": Record<string, never>;
  "GET /api/events/{id}/webhooks": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/webhooks": {
    params: {
      id: string;
    };
    body: {
      url: string;
      secret?: string | null;
      events?: string[];
    };
  };
  "PATCH /api/events/{id}/webhooks/{webhookId}": {
    params: {
      id: string;
      webhookId: string;
    };
    body: {
      events?: string[];
      disabled?: boolean;
    };
  };
  "DELETE /api/events/{id}/webhooks/{webhookId}": {
    params: {
      id: string;
      webhookId: string;
    };
  };
  "POST /api/events/{id}/webhooks/{webhookId}/test": {
    params: {
      id: string;
      webhookId: string;
    };
  };
  "GET /api/users/{id}": {
    params: {
      id: string;
    };
  };
  "PATCH /api/users/{id}": {
    params: {
      id: string;
    };
    body: {
      name?: string;
      publicStats?: boolean;
      profileVisibility?: "public" | "participants" | "private";
    };
  };
  "PUT /api/users/me/push-prompt-state": {
    body: {
      state: "default" | "granted" | "dismissed" | "denied";
    };
  };
  "GET /api/me/games": {
    query: {
      ownedCursor?: string;
      followedCursor?: string;
    };
  };
  "GET /api/me/home": Record<string, never>;
  "POST /api/me/follows": {
    body: {
      eventId: string;
    };
  };
  "POST /api/me/app-open": Record<string, never>;
  "GET /api/me/co-players": Record<string, never>;
  "GET /api/me/locations": Record<string, never>;
  "GET /api/places": {
    query: {
      q?: string;
      lat?: number;
      lng?: number;
    };
  };
  "GET /api/me/stats": Record<string, never>;
  "GET /api/me/profile": Record<string, never>;
  "PUT /api/me/profile": Record<string, never>;
  "DELETE /api/me/account": {
    body: {
      password?: string;
    };
  };
  "GET /api/me/export": Record<string, never>;
  "POST /api/me/photo": {
    body: {
      image: string;
    };
  };
  "DELETE /api/me/photo": Record<string, never>;
  "GET /api/me/notifications": {
    query: {
      limit?: number;
      cursor?: string;
    };
  };
  "POST /api/me/notifications": {
    body: {
      ids?: string[];
    };
  };
  "GET /api/me/notification-preferences": Record<string, never>;
  "PUT /api/me/notification-preferences": {
    body: {
      emailEnabled?: boolean;
      pushEnabled?: boolean;
      gameInviteEmail?: boolean;
      gameInvitePush?: boolean;
      gameReminderEmail?: boolean;
      gameReminderPush?: boolean;
      playerActivityPush?: boolean;
      eventDetailsPush?: boolean;
      postGamePush?: boolean;
      weeklySummaryEmail?: boolean;
      paymentReminderEmail?: boolean;
      paymentReminderPush?: boolean;
      invitesEnabled?: boolean;
      reminder24h?: boolean;
      reminder2h?: boolean;
      reminder1h?: boolean;
    };
  };
  "GET /api/me/payment-details": Record<string, never>;
  "PUT /api/me/payment-details": {
    body: {
      phone?: string;
      paymentDetails?: { type: "phone" | "mbway" | "revolut_tag" | "revolut_link" | "cash" | "other"; value: string; label?: string }[];
      sharePaymentDetails?: boolean;
    };
  };
  "POST /api/me/calendar-token": {
    body: {
      scope?: "user" | "event";
      eventId?: string;
    };
  };
  "DELETE /api/me/calendar-token": Record<string, never>;
  "GET /api/me/credentials": Record<string, never>;
  "DELETE /api/me/credentials": {
    body: {
      accountId: string;
    };
  };
  "GET /api/me/credentials/pending-merge": Record<string, never>;
  "POST /api/me/credentials/merge": {
    body: {
      confirm: true;
    };
  };
  "GET /.well-known/openid-configuration": Record<string, never>;
  "GET /api/auth/oauth2/public-client": {
    query: {
      client_id: string;
    };
  };
  "POST /api/auth/oauth2/consent": {
    body: {
      accept: boolean;
      oauth_query: string;
    };
  };
  "GET /api/auth/oauth2/authorize": {
    query: {
      client_id: string;
      redirect_uri: string;
      response_type: "code";
      scope?: string;
      state: string;
      code_challenge: string;
      code_challenge_method: "S256";
    };
  };
  "POST /api/auth/oauth2/token": Record<string, never>;
  "POST /api/auth/oauth2/register": {
    body: {
      redirect_uris: string[];
      client_name?: string;
      client_uri?: string;
      logo_uri?: string;
      scope?: string;
      token_endpoint_auth_method?: "none" | "client_secret_basic" | "client_secret_post";
      grant_types?: string[];
      response_types?: string[];
    };
  };
  "GET /api/auth/oauth2/userinfo": Record<string, never>;
  "POST /api/auth/oauth2/introspect": Record<string, never>;
  "POST /api/auth/oauth2/revoke": Record<string, never>;
  "GET /api/court-watches": Record<string, never>;
  "POST /api/court-watches": {
    body: {
      sport: string;
      tenantId: string;
      tenantName: string;
      resourceId?: string;
      resourceName?: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      timezone?: string;
    };
  };
  "DELETE /api/court-watches/{id}": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/court-alternatives": {
    params: {
      id: string;
    };
    query: {
      radius?: number;
      startTime?: string;
      endTime?: string;
      indoor?: boolean;
      includeBooked?: boolean;
    };
  };
  "PUT /api/events/{id}/court-alternatives": {
    params: {
      id: string;
    };
    body: {
      enabled: boolean;
      radius?: number;
      indoor?: boolean | null;
    };
  };
  "POST /api/events/{id}/switch-court": {
    params: {
      id: string;
    };
    body: {
      location: string;
      latitude?: number;
      longitude?: number;
      dateTime?: string;
    };
  };
  "POST /api/events/{id}/stakes-preview": {
    params: {
      id: string;
    };
    body: {
      teamOne?: string[];
      teamTwo?: string[];
    };
  };
  "GET /api/events/{id}/suggestions": {
    params: {
      id: string;
    };
  };
  "GET /api/events/{id}/invites": {
    params: {
      id: string;
    };
  };
  "POST /api/events/{id}/invites": {
    params: {
      id: string;
    };
    body: {
      userId?: string;
      email?: string;
      name?: string;
      deliver?: boolean;
    };
  };
  "PATCH /api/events/{id}/invites": {
    params: {
      id: string;
    };
    body: {
      inviteId: string;
    };
  };
  "DELETE /api/events/{id}/invites": {
    params: {
      id: string;
    };
    body: {
      inviteId: string;
    };
  };
  "GET /api/invite/{token}": {
    params: {
      token: string;
    };
  };
  "POST /api/invite/{token}": {
    params: {
      token: string;
    };
    body: {
      action: "accept" | "decline";
      asGuest?: boolean;
    };
  };
  "GET /api/mcp": Record<string, never>;
  "POST /api/mcp": {
    body: {
      jsonrpc?: string;
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
  };
  "GET /api/admin/check": Record<string, never>;
  "GET /api/admin/stats": Record<string, never>;
  "GET /api/admin/growth": {
    query: {
      range?: string;
    };
  };
  "GET /api/admin/usage": {
    query: {
      days?: number;
    };
  };
  "GET /api/admin/users": {
    query: {
      page?: number;
      pageSize?: number;
      search?: string;
      sort?: string;
      order?: string;
      hasPushToken?: string;
      pushPlatform?: string;
    };
  };
  "DELETE /api/admin/users/{id}": {
    params: {
      id: string;
    };
  };
  "GET /api/playtomic/clubs": {
    query: {
      lat?: number;
      lng?: number;
      sport?: string;
      radius?: number;
      size?: number;
    };
  };
  "GET /api/playtomic/availability": {
    query: {
      tenantId?: string;
      date?: string;
      sport?: string;
      duration?: number;
    };
  };
  "GET /.well-known/oauth-protected-resource": Record<string, never>;
  "GET /.well-known/oauth-authorization-server": Record<string, never>;
}
