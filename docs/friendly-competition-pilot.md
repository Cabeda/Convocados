# Friendly competition pilot

Status: design interview in progress

Pilot Event: [Ninjas da Areosa](https://convocados.fly.dev/events/cmmkfrx8b0000o2ixrix1yp2m)
Tracking issue: [#875](https://github.com/Cabeda/Convocados/issues/875)

## Purpose

Test whether a quiet competitive layer can create friendly rivalries, temporary team identity, and better post-game conversation. Player improvement is a welcome side effect, but identifying the group's best player is not the main goal.

The pilot must not pressure people to attend, expose weaker players, or make the ordinary weekly game feel more serious for people who are not interested.

## Group

- Around 40 players participate in the Event.
- One 5-a-side Game is played each week.
- The Attendance page contains 23 Games, 36 named players, and 227 appearances. Games averaged 9.87 players, so the weekly Game is almost always full.
- Four players attended 17 to 20 Games. Another five attended 12 to 15. Six attended 6 to 10, two attended 3 to 5, and nineteen appeared only once or twice.
- The Event therefore has a core of nine regulars, a middle group of six rotating players, and a long substitute tail. Conventional fixed teams would not survive this attendance pattern.
- Some players prefer to play alongside particular friends.

## Settled decisions

- A Season is an optional layer attached to an existing Event.
- An Event Owner or Admin decides whether Seasons are available for that Event.
- The Event page continues to focus on the next Game. Competition information does not get a dashboard, banner, or standings block there.
- Interested players reach it through a dedicated link alongside History, Attendance, and Ratings in the More menu.
- Players explicitly opt into a Season. Non-participants never appear in its standings or get assigned to a Crew.
- Ordinary non-friendly Games may count for opted-in participants without turning the Game itself into a competitive fixture. A non-participant may affect the result while remaining outside the Season.
- The public championship is between Crews. Individual contribution and progress are private; the existing Ratings page remains the place for individual comparison.
- The existing long-lived ELO remains the source for team balancing. Seasonal achievement must not reset or replace it.
- A Crew is self-selected and contains three to five Season participants. Players without a Crew may enter as free agents.
- Crew membership creates identity, not an attendance obligation or a guaranteed Game lineup. Players continue to join each Game independently.
- Crew membership locks globally when the Season becomes active. During an active Season, an Admin may approve one replacement if a member leaves the group.
- Crew members contribute their own Game result even when they play on opposite sides. Only confirmed Crew members assigned to one of the immutable match-team lineups receive a win, draw, or loss contribution; bench and payment-only participants do not.
- Team balance remains the first constraint. Team generation may keep at most two members of one Crew together only when both sides remain within a 45% to 55% expected win range.
- The pilot lasts for the next eight eligible Games rather than a fixed calendar period. Cancellations and ineligible Games do not consume a round.
- An eligible Game is marked Played, is non-friendly, and has two valid immutable team lineups. Eligibility is automatic, including a `0-0` draw. A Played Game without usable lineups does not consume a Season round.
- Each Crew counts its best six Game scores from those eight Games. It may miss two Games without damage, and no individual member has a minimum attendance requirement.
- A player earns 3 points for a win, 1 for a draw, and 0 for a loss. A Crew's score for a Game is the arithmetic mean of every member who participated in that Game. A Crew with no participant scores 0 for that Game.
- Every Crew remains ranked even when it has fewer than six represented Games; missing Game scores are 0. A tie on the best-six total uses the total across all eight Games, including dropped scores. Crews still equal after that share the position.
- The public Season page shows Crew names, members, position, total, six counted scores, two dropped scores, and non-scoring highlights. It does not expose individual Season totals or member rankings.
- Each participant privately sees their own result and contribution, the resulting Crew average, and whether that Game counts among the Crew's best six. Admins may inspect every contribution to audit the calculation.
- Goal difference, MVP votes, pair wins, and ELO upsets never add Season points. They may appear only as non-scoring highlights.
- Pilot success compares the eight-Game Season with the preceding eight eligible Games. Crew-pair co-attendance should increase by at least 20%, and at least 60% of co-attending Crew pairs should play on the same side without breaking the balance limit.
- At least 70% of Season participants should opt into a second Season. Non-participant attendance must not decline; this is a safety guardrail rather than an engagement target.
- At least three confirmed Crews and nine participants must register before the pilot starts. Free agents join a Crew only after accepting an invitation; if fewer than three Crews form, the pilot is postponed.
- Registration stays open for two weeks. A player creates a Crew and invites up to four friends, each invited member confirms independently, and solo players may enter the free-agent pool. The first eligible Game after registration closes starts the Season.
- Crew-aware team generation is automatic. The generator first finds the best-balanced assignment, then considers only assignments no more than two expected-win percentage points worse than that optimum and still inside the absolute 45% to 55% range. It maximizes Crew pairs within that candidate set, returns to balance as the next tie-breaker, then prefers Crew pairs that have played together least often that Season. Exact ties are random.
- The complete thin pilot lives in Convocados: Admin Season controls, Crew registration and confirmation, free agents, automatic standings, Crew-aware team generation, the Season page, and winner badges.
- The Season is reached from a link in the Event's More menu. It does not create a dedicated chat or send weekly messages to the main WhatsApp group.
- The main WhatsApp group receives two messages: registration opening with the Event link, and the final winning Crew with the final-table link.
- The winning Crew remains badged in Season history. Each winning member who played at least one eligible Game receives a profile badge; merely registering is not enough. Neither badge appears on the main Event page.
- Only account-linked EventPlayers may join a Season. Anonymous EventPlayers continue playing normal Games but never enter Crews or Season standings.
- A Season moves through `registration`, `active`, `review`, and `completed`, or ends as `cancelled`. An Event may have only one Season in a non-terminal state. Completed and cancelled Seasons remain in history, and cancellation records an Admin-supplied reason.
- Registration closes globally when the Season becomes active. No new Crews or ordinary late joins are allowed. A participant may withdraw at any time; they stop contributing and affecting Crew-aware pairing, while their historical contributions remain.
- Each Crew may use one Admin-approved replacement during an active Season. A replacement affects only future Games. A Crew that falls below three members remains ranked and cannot erase results by dissolving. Per-Game membership is snapshotted.
- A former member who contributed to an eligible Game still receives a winner badge if that Crew wins.
- While a Season is active, score corrections and retroactive Friendly changes automatically recompute standings and the eight-Game sequence. After the eighth eligible result, the Season enters a 48-hour review period before an Admin finalizes it.
- Completed standings do not silently change. An Admin must explicitly reopen a completed Season to apply later source-Game corrections; reopening is audited and may revoke and reissue badges.
- Web and Android phone expose registration, Crews, standings, badges, and Crew-aware team generation. WhatsApp links open the web Season page. Wear OS score entry continues feeding backend standings, but Wear does not add registration or standings UI in the pilot.
- The feature requires user-facing rules and contextual explanations so participants understand scoring, attendance, pairing, membership changes, review, and badges before opting in.
- The first pilot ends with the table winner and badge. A Final Four is deferred as a separate future year-end Crew Cup with its own lineup, substitute, scheduling, qualification, and forfeit rules.
- Pilot rules are fixed. Admins configure only the Season name and registration dates, then may cancel, approve one replacement per Crew, reopen, or finalize. Alternative competition rules may become named presets only after testing.
- Before opting in, a player sees the eight-Game and best-six format, 3/1/0 averaging, lack of attendance commitment, balance-first pairing, public Crew standings, private individual contributions, membership lock, withdrawal right, replacement rule, and badge eligibility. The Season page retains a full rules explanation and worked scoring example.
- Any account-linked EventPlayer may create one Crew and becomes its Captain. Captains name the Crew, invite up to four members, and cancel pending invitations. They cannot remove confirmed members without consent or Admin intervention, and cannot control scores, standings, replacements, or team generation.
- Crew names are unique within a Season and subject to Admin moderation. Unmatched free agents are never assigned automatically; their opt-in expires when registration closes.
- Convocados sends no new Season push or email notifications. Season and Crew changes extend the Event's existing opt-in webhook subscriptions, while invitations and state remain visible in-app and Captains may share the Event link themselves.
- The webhook catalog adds `season_registration_opened`, `crew_created`, `crew_invitation_created`, `crew_membership_changed`, `season_started`, `season_standings_updated`, `season_review_started`, `season_completed`, `season_cancelled`, and `season_reopened`. Membership changes carry a joined, declined, withdrew, or replaced action.
- Webhook payloads retain the existing event-scoped envelope and may expose stable IDs, public display names, status, round number, public standings totals, and the generic Season URL. They never include email addresses, invitation tokens, private invite URLs, individual contributions, ELO ratings, withdrawal reasons, or secrets.
- Webhook delivery becomes durable and at-least-once. Pending deliveries survive process restarts, and consumers deduplicate by `deliveryId`.
- Expanding webhooks requires authorization on test and delivery-history endpoints, HTTP(S)-only destinations, private-network and metadata blocking with redirect revalidation, mutation and test-send rate limits, one centralized event catalog, safe payload retention, disabled-subscription controls, and secret re-enablement or rotation.
- An Event may open Season registration only while ELO and balanced-team generation are enabled. Those settings remain locked through active competition and review; an Admin must complete or cancel the Season before disabling either one.
- Season access inherits Event access. Anyone who may view the Event may view Crew names, members, rules, and standings. `showCompetitiveData` continues controlling individual ELO data and does not hide an explicitly enabled Season.
- Crew and Season scores display two decimal places but rank on unrounded values derived from the underlying result counts. Crews still tied for first after the all-eight-Games tie-breaker are co-champions, and every eligible co-champion receives the same badge.
- At registration close, Crews with fewer than three confirmed members do not qualify. Their members become unmatched free agents whose opt-ins then expire. Crew names lock when competition starts; only Admin typo corrections or moderation remain allowed.
- If a Captain withdraws, the longest-standing confirmed member becomes Captain. Captain transfer does not consume the Crew's replacement. A Crew whose entire membership withdraws remains in historical standings and scores zero in future rounds.

## Current product constraints

Convocados currently stores ELO across the lifetime of an Event. Generated teams are mutable assignments for the current Game and are replaced when teams change. It has no Season, persistent team identity, seasonal standings, or stable Crew membership.

The in-app pilot therefore requires persistent Season and Crew identity, consented membership, immutable per-Game contribution snapshots, Crew-aware balanced generation, standings, and badge awards. It must not build seasonal behavior on the current mutable `TeamResult` projection.

## Deferred decisions

These are explicitly outside the first pilot:

- Crew Cup qualification, 5-player lineups, substitutes, forfeits, scheduling, and annual versus per-Season timing
- Alternative named rule presets after the fixed pilot format has real usage data
- A compact Wear OS standings view
