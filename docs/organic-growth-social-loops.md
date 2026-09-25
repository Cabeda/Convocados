# Organic growth & social loops for Convocados

Status: research note. Scope: word-of-mouth / social growth mechanics for a consumer,
amateur-sports app; recommendations use only the primitives already in the product
(Event/Game/EventPlayer/GameParticipant, Unlisted Event, Guest Invite Link, Claiming,
Follow tiers, Skill Rating, Season/Crew, post-game wrap-up, payments, Open Pickup, Home).

**Binding constraint: cold start.** The product has essentially one Event, and most games
are coordinated informally in WhatsApp off-platform. The app has players but few organisers.
That makes the first job *mapping real games into the app* (supply of Events), and the second
job *bringing more players into mapped games*. A social loop that only acquires spectators is
worthless; every mechanic below is judged on whether it adds a **Game** or a **GameParticipant**.

---

## 1. Referral and invite loops

The standard model is the viral coefficient **K = i × c** (invites per user × invite conversion).
K > 1 is self-sustaining but rare and usually temporary; healthy compounded programs sit at
**K ≈ 0.3–0.7**, and **cycle time** matters as much as K because `users(t) ≈ users(0)·K^(t/cycle)`
([Salminen, viral coefficient paper](https://jonisalminen.com/wp-content/uploads/2018/08/viral-coefficient.pdf),
[First Round K-factor glossary](https://review.firstround.com/glossary/k-factor-virality/),
[Mendelson & Moon, ACM 2018](https://doi.org/10.1145/3178876.3186123)). Practically: measure K
per signup cohort, not in aggregate, and fix the weaker factor (i or c) first
([nativeviralloop](https://nativeviralloop.com/knowledge/viral-coefficient.html)).

Two-sided rewards are the best-evidenced amplifier:

| Program | Mechanic | Outcome | Source |
|---|---|---|---|
| PayPal | give $10 / get $10 | 7–10% daily growth early; $60–70M spent | [Secondary, reporting Thiel's *Zero to One*](https://www.aakashg.com/paypal-the-original-product-growth-company/) |
| Dropbox | 500 MB both sides | 100k→4M in 15 mo; ~35% of daily signups referred; +60% signups | [Secondary, Dropbox presentation](https://omegapoint.systems/case-studies/dropbox-referral-program) |
| Uber | rider + driver referrals | referrals a top driver-supply lever | [Uber blog](https://www.uber.com/us/en/blog/earn-cash-between-rides-2/), [ex-Uber growth lead](https://scottgorlick.substack.com/p/scaling) |
| Robinhood | free stock both sides | CAC $53→$20→$15; >80% of new funded accounts organic/referral | [BI, reporting S-1](https://www.businessinsider.com/robinhood-customer-acquisition-costs-details-marketing-budget-ipo-filing-hood-2021-7) |

Two hard constraints matter more than the case studies:

- **App-store rules.** Apple 3.2.2(x) forbids forcing store actions (rate/download) to unlock
  function, while allowing in-app action incentives
  ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). A developer
  forum thread quoting App Review states that rewarding the *sender* is acceptable but
  **rewarding the invitee for downloading/registering is not** (developer forum, not primary —
  treat as guidance, not policy).
- **Privacy law.** The Belgian DPA fined Twoo €50,000 for a tell-a-friend feature: the sender's
  consent is *not* a valid legal basis for emailing non-users; uploading address books to invite
  non-members requires the recipient's consent, and only a "compare-and-forget" check can rest on
  legitimate interest ([iApp](https://iapp.org/news/a/tell-a-friend-but-only-with-your-friends-consent),
  [Lexology](https://www.lexology.com/library/detail.aspx?g=26307840-a7cf-4ef6-9388-dc1468a6bf76),
  [EDPB](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en)).

**Implication:** never upload contacts; never gate a feature behind an install; never reward an
install. Grow by *sharing an unguessable Guest Invite Link into an existing WhatsApp thread* —
an invite token is a capability (possession authorises access; canonical W3C cite **unverified**),
so the link itself does the work without touching third-party contact data.

**"Invite to unlock" backfires.** Growth-design literature and practitioner analyses warn that
requiring social invites before value is delivered reads as needy and can poison onboarding
([secondary: Yu-kai Chou](https://yukaichou.com/gamification-analysis/onboarding-design-gamification-first-five-minutes/));
screenshot analyses of "invite 3 friends to unlock" gates are growth-first, trust-later
([secondary: ScreensDesign](https://screensdesign.com/showcase/umax-become-hot)). Reward
referrals *after* the player has experienced a game.

---

## 2. Shared artifacts as distribution

A shareable artifact must be legible to insiders, opaque to outsiders, and require the product
to fully participate.

- **Wordle** auto-generated a spoiler-free emoji grid with **no URL and no handle**; Wardle argued
  a link "looks kind of crap". It became "a club you're either part of or not", and NYT credited it
  with "tens of millions" of new users ([NYT](https://www.nytimes.com/2022/01/14/crosswords/everyone-wants-to-be-wordle.html),
  [TechCrunch](https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth/),
  [Ars Technica/GDC](https://arstechnica.com/gaming/2022/03/wordle-creator-describes-games-rise-says-nyt-sale-was-a-way-to-walk-away/)).
  Note the tension: no CTA made it spread but leaked brand attribution — for Convocados the
  artifact must carry the unlisted-event link.
- **Strava** shares activity cards, segment leaderboards and route embeds; its Giro d'Italia
  activation drove **+51,000 club members (+129%) and 6.6M impressions** in one month
  ([Strava case study](https://partners.strava.com/case-studies/giro-ditalia-growing-a-global-community)).
- **Partiful/Luma** treat the event page as a distribution asset: shareable to WhatsApp, visible
  guest lists, browser RSVP without an install ([Partiful](https://partiful.com/blog/post/heres-how-to-actually-grow-your-audience),
  [Luma vs Partiful](https://help.luma.com/p/luma-vs-partiful)).
- **Venmo** showed that a public feed of shared activity builds credibility and social learning,
  even in an "instrumental" app ([PACM HCI paper](https://www.smunson.com/portfolio/projects/pacmhci028_venmo.pdf));
  ~90% of transactions were shared (**secondary**, reporting PayPal's CEO, in
  [arXiv study](https://arxiv.org/html/1806.06328)).

**Implication:** the post-game wrap-up (score, MVP, teams, standings) is the natural shareable
artifact. It's the game equivalent of the Wordle grid — but unlike Wordle it should embed the
unlisted Event link.

---

## 3. Reciprocity and social obligation

Named-person invites outperform generic landing pages, and visible guest lists convert
(secondary: [LaunchList](https://getlaunchlist.com/blog/viral-coefficient-k-factor-guide);
Cialdini's commitment/consistency, **secondary**). Team-management incumbents make joining
self-serve: **Spond** shares a group link/code and attributes 1.4M users to word of mouth
([Spond](https://www.spond.com/en-us/news-and-blog/new-team-management-app-spond/));
**TeamSnap** added Team Invite Codes/Links so parents join a rostered player without an admin
entering every email ([TeamSnap release notes](https://teamsnapone.launchnotes.io/announcements/ann_kekMwkqI7zwUh)).
Social obligation converts, but only when consent is clean and the invitee can see who's already in.

---

## 4. Status, progress, rewards — and crowding-out

**Evidence that works:** Duolingo's leaderboards raised learning time **+17%** and tripled
highly-engaged users; streak-saver notifications and streak mechanics drove retention, and
Duolingo grew DAU **4.5×**, roughly 90% of it word-of-mouth
([Duolingo blog](https://blog.duolingo.com/growth-principles/), [Jorge Mazal, Lenny's](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)).
The same source carries the key warning: Groupon destroyed its email channel by increasing
volume; Duolingo made "protect the channel" a rule.

**Evidence against crude incentives:** the Deci/Koestner/Ryan meta-analysis (128 studies) found
engagement-, completion- and performance-contingent rewards *undermined* free-choice intrinsic
motivation (d = −0.40, −0.36, −0.28), while **positive feedback enhanced it (d = +0.33)**
([PubMed](https://pubmed.ncbi.nlm.nih.gov/10589297/),
[full PDF](https://leeds-faculty.colorado.edu/dahe7472/deci%201999.pdf)). Cameron & Pierce dispute
the pervasiveness but still find negative effects for tangible, expected rewards loosely tied to
performance ([Springer](https://link.springer.com/article/10.1007/BF03392017)); a 2023 thesis
largely reconfirms the undermining pattern while finding task-non-contingent rewards harmless
([UTU thesis](https://www.utupub.fi/handle/10024/173853)). Strava's kudos — informational social
affirmation — measurably increased running frequency and volume
([Franken et al., *Social Networks*](https://doi.org/10.1016/j.socnet.2022.10.001)).

**Implication:** prefer **informational feedback** (kudos, MVP, badges, tier transitions, "organiser
score") over cash/units for participation. If tangible rewards are used, tie them to a *performance
or achievement* outcome, not mere attendance.

---

## 5. Loss aversion, deadlines, scarcity

Scarcity is real but two-sided. A Chinese e-commerce field experiment found limited-quantity and
limited-time scarcity raised arousal and impulse purchase
([Nottingham](https://research.nottingham.edu.cn/en/publications/how-does-scarcity-promotion-lead-to-impulse-purchase-in-the-onlin/));
a 22,000-user field experiment found a **costless scarcity nudge ~2.3× more effective than a price
incentive** in the early (no-cart) stage ([Luo et al., *ISR* 2019](https://ideas.repec.org/a/inm/orisre/v30y2019i4p1203-1227.html)).
But a Dutch National Opera experiment found scarcity *lowered* purchase intention and raised
persuasion resistance ([ICORIA paper](https://ris.utwente.nl/ws/files/13753628/ICORIA_2017_paper_40.pdf)).
Limited-quantity + social cue is the combination that raises competition
([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1447677021000437)).

**Rule:** only show scarcity that is true. "Few spots left", waitlists and auto-promotion are
credible for capacity-bound pickup games; a countdown to a soft deadline is not.

---

## 6. Group and social-proof mechanics

- **Clubs/leagues as recurring loops.** Strava clubs and leaderboards are heavily used
  ([Strava eng](https://medium.com/strava-engineering/scaling-club-leaderboard-infrastructure-for-millions-of-users-9ee857ce8cfe));
  Strava infers a **co-play graph** from shared spatiotemporal activity
  ([activity grouping](https://medium.com/strava-engineering/activity-grouping-the-heart-of-a-social-network-for-athletes-865751f7dca)).
- **Chess.com** limits club invites to 30/24h (an anti-spam cap), auto-joins clickers via a club
  landing page, and runs leagues, club matches and vote chess
  ([clubs](https://support.chess.com/en/articles/8718710-how-do-chess-com-clubs-work),
  [admins FAQ](https://support.chess.com/en/articles/10198889-club-admins-faq)).
- **Playtomic/PwC** report a **92% retention rate among first-time padel players** and show
  structured formats (open matches, leagues, academies) driving recurring play and higher
  monetisation ([Global Padel Report 2025](https://8258038.fs1.hubspotusercontent-na1.net/hubfs/8258038/Global%20Padel%20Report/PLAYTOMIC_GLOBAL%20_PADEL_REPORT_2025.pdf)).
- **Venmo and Strava** both show that peers' visible activity changes behaviour (social learning,
  kudos → more running).

**Implication:** a visible group ("your crew plays Tuesday") plus a per-game co-play recap is the
strongest retention loop available, and it maps onto EventPlayer attendance and Crew/Season.

---

## 7. Notifications and re-engagement

Vendor benchmarks: ~30% of consumers delete an app because of excessive ads/notifications,
while opt-in is ~44% iOS / ~91% Android ([CleverTap 300B-push study](https://clevertap.com/blog/push-notification-report/));
Airship's annual benchmarks track direct opens, opt-outs and uninstalls side by side
([Airship 2025 PDF](https://growth.airship.com/rs/313-QPJ-195/images/Airship-2025-Push-Notification-Benchmarks-EN.pdf));
a user inactive for long periods is both less reachable and more likely to have uninstalled
([Business of Apps](https://www.businessofapps.com/insights/removing-the-obstacles-to-a-successful-push-notification-campaign/)).
Duolingo's "protect the channel" rule ("never increase quantity without strong justification") is
the right default; Convocados' existing Tier 1/Tier 2 split already enforces relevance.

---

## 8. Anti-patterns and constraints

| Anti-pattern | Evidence |
|---|---|
| Viral spam via misleading auto-share | Socialcam hit 16M downloads then Facebook cracked down; app discontinued ([AllThingsD](https://allthingsd.com/20120516/socialcam-facebook-viddy/), [secondary post-mortem](https://unicornburn.com/autopsy/socialcam-mobile-video-usa)) |
| Reminder emails / name-and-likeness abuse | LinkedIn paid **$13M** over "Add Connections" reminder emails ([settlement notice](https://digitalcommons.law.scu.edu/historical/1059), [Guardian](https://www.theguardian.com/technology/2015/oct/07/linkedin-lawsuit-add-connection-feature)) |
| Forced/early social invites | Onboarding research says social asks before value read as needy (secondary: Yu-kai Chou); invite-to-unlock gates (secondary: ScreensDesign) |
| Contact-book upload to invite non-users | Belgian DPA €50k Twoo fine ([iApp](https://iapp.org/news/a/tell-a-friend-but-only-with-your-friends-consent)) |
| Rewarding an install / forcing store actions | Apple 3.2.2(x) ([guidelines](https://developer.apple.com/app-store/review/guidelines/)) |
| Fake scarcity | Lowers purchase intention for high-persuasion-knowledge users ([ICORIA](https://ris.utwente.nl/ws/files/13753628/ICORIA_2017_paper_40.pdf)) |
| Pay-to-win / attendance shaming | Contingent tangible rewards undermine intrinsic motivation (Deci et al. 1999) |

---

## 9. Ranked shortlist for Convocados

Effort: S ≤ ~1 week, M ≤ ~1 month, L > 1 month.

| # | Mechanic | Why it works (cite) | Existing primitive | Effort | Anti-pattern to avoid |
|---|---|---|---|---|---|
| 1 | **"X invited you" claim landing page** on every Guest Invite Link: name, next Game, spots left, visible guest list, one-tap anonymous join | Named invites + social proof convert; friction kills c ([LaunchList](https://getlaunchlist.com/blog/viral-coefficient-k-factor-guide), [Partiful](https://partiful.com/)) | Guest Invite Link, Claiming, Unlisted Event, Follow | S | No signup wall; no contact upload; no reward for *registering* |
| 2 | **Post-game shareable match card** (score, teams, MVP, top scorer; "spoiler-light") with the Event link baked in | Wordle grid + Strava cards carry a group's brand into new groups | Post-game wrap-up, GameParticipant, Unlisted Event | M | Leaking private data/geo; auto-posting without opt-in |
| 3 | **Bring-a-player priority enrollment**: inviter and invitee both get priority for the next Game's slot once the invitee *plays* | Two-sided rewards outperform; Google/Apple-safe because reward is an in-app perk tied to play, not install | Guest Invite Link, priority enrollment, Wallet/Game Units | M | GDPR contact upload; rewarding install; rewarding self-referral alts |
| 4 | **"Your crew plays Tuesday" co-play recap**: surface players who attend together and offer one-tap "re-add the crew" | Co-play graph + visible group activity drives retention (Strava grouping; Playtomic 92% retention) | EventPlayer attendance history, Manager-initiated add, Follow tiers | M | Exposing who dropped out; spammy re-adds |
| 5 | **Organiser Score / contribution badges** (hosted, filled a slot, added a player, entered scores) — informational only | Positive feedback enhances intrinsic motivation (d=+0.33); cash-like contingent rewards crowd it out | Season Rank/Tier, badges, MVP | S/M | Public shaming of low attendance; score gaming |
| 6 | **True scarcity + waitlist auto-promotion**: "few spots left", T-48h recruitment ping to followers, waitlist fills cancellations | Limited-quantity scarcity raises urgency (Luo 2019); recruitment ping already exists | Follow Tier 1, Home "Needs you", Open Pickup | S/M | Fake scarcity; countdown theatre |
| 7 | **Season/Crew ladder + cross-crew recruiting** (already specced): recruiting challenge invites other local groups | Leagues/leaderboards + group identity drive compounding retention (Duolingo, Chess.com, Playtomic) | Season/Crew/Season Rank/Tier | L | Attendance obligation; making casual players feel ranked |
| 8 | **Discoverable Event + city/format landing page** for Open Pickup converts and unlisted-event opt-in | Explore/public discovery expands beyond existing graph (Partiful Explore; Chess.com club landing pages) | Open Pickup, geocoding, Unlisted vs Discoverable | M | Publishing private games without consent |

---

## 10. Recommended first experiment

**Name:** "Add your crew" — Guest Invite Link claim loop on the live pilot Event
(Ninjas da Areosa), instrumented end-to-end.

**Method.** After each Game wraps, every confirmed GameParticipant gets a one-tap *Add your crew*
CTA that mints a Guest Invite Link bound to a new Anonymous EventPlayer. The link opens a
"Marco invited you — Tuesday 21:00, 4 spots left" page with the visible guest list and a one-tap
anonymous Join. Inviters who bring a player who *attends* one Game get priority enrollment in a
later Game (sender-side; no invitee reward on install).

**Measurable success metric.** Over 4 weeks, per signup cohort:
- `i` (invite links created per active player) ≥ 0.5;
- `c` (link opens → claimed/joined participants) ≥ 25%;
- **K = i × c ≥ 0.15** and at least **5 new distinct players attend a Game**;
- ≥ 20% of newly invited players add or map a second Game within 30 days (the cold-start test).

**Kill criterion.** Stop and redesign if, after 4 weeks, `c < 15%` **or** zero invited players map
or join a second Game. Safety guardrail: if >2% of invitees report spam, halt immediately.

**Why this first.** It is the only proposal that simultaneously tests loop mechanics *and* the
cold-start constraint, uses only existing primitives, ships in days, and cannot violate the
privacy/app-store rules in §8.

---

## Sources

- Salminen, viral coefficient — https://jonisalminen.com/wp-content/uploads/2018/08/viral-coefficient.pdf
- First Round, K-factor — https://review.firstround.com/glossary/k-factor-virality/
- Mendelson & Moon, "Modeling Success and Engagement for the App Economy" — https://doi.org/10.1145/3178876.3186123
- NativeViralLoop, viral coefficient — https://nativeviralloop.com/knowledge/viral-coefficient.html
- LaunchList, K-factor guide — https://getlaunchlist.com/blog/viral-coefficient-k-factor-guide
- Aakash Gupta, PayPal growth (secondary) — https://www.aakashg.com/paypal-the-original-product-growth-company/
- Omega Point, Dropbox referral (secondary) — https://omegapoint.systems/case-studies/dropbox-referral-program
- Kalzumeus, Dropbox two-sided incentives — https://www.kalzumeus.com/2010/04/28/dropbox-style-two-sided-sharing-incentives/
- Uber referral blog — https://www.uber.com/us/en/blog/earn-cash-between-rides-2/
- Scott Gorlick, scaling Uber (first-person) — https://scottgorlick.substack.com/p/scaling
- Business Insider, Robinhood/S-1 (secondary) — https://www.businessinsider.com/robinhood-customer-acquisition-costs-details-marketing-budget-ipo-filing-hood-2021-7
- Apple, App Review Guidelines — https://developer.apple.com/app-store/review/guidelines/
- Apple Developer Forums, referral rejection thread (developer forum) — https://developer.apple.com/forums/thread/108548
- iApp, tell-a-friend / Twoo — https://iapp.org/news/a/tell-a-friend-but-only-with-your-friends-consent
- Lexology, Belgian DPA referral fine — https://www.lexology.com/library/detail.aspx?g=26307840-a7cf-4ef6-9388-dc1468a6bf76
- EDPB, lawful processing — https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en
- NYT, Wordle virality — https://www.nytimes.com/2022/01/14/crosswords/everyone-wants-to-be-wordle.html
- TechCrunch, Wordle/NYT users — https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth/
- Ars Technica, Wardle GDC talk — https://arstechnica.com/gaming/2022/03/wordle-creator-describes-games-rise-says-nyt-sale-was-a-way-to-walk-away/
- Strava × Giro d'Italia case study — https://partners.strava.com/case-studies/giro-ditalia-growing-a-global-community
- Partiful, growing an audience — https://partiful.com/blog/post/heres-how-to-actually-grow-your-audience
- Luma, Luma vs Partiful — https://help.luma.com/p/luma-vs-partiful
- Venmo SAS paper (PACM HCI) — https://www.smunson.com/portfolio/projects/pacmhci028_venmo.pdf
- Venmo network evolution (arXiv) — https://arxiv.org/html/1806.06328
- Spond, new team management app — https://www.spond.com/en-us/news-and-blog/new-team-management-app-spond/
- TeamSnap ONE release notes — https://teamsnapone.launchnotes.io/announcements/ann_kekMwkqI7zwUh
- Duolingo, growth principles — https://blog.duolingo.com/growth-principles/
- Duolingo, growth model — https://blog.duolingo.com/growth-model-duolingo/
- Jorge Mazal, Lenny's Newsletter — https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth
- Deci, Koestner & Ryan 1999 (PubMed) — https://pubmed.ncbi.nlm.nih.gov/10589297/
- Deci et al. 1999 (full PDF) — https://leeds-faculty.colorado.edu/dahe7472/deci%201999.pdf
- Cameron & Pierce (Springer) — https://link.springer.com/article/10.1007/BF03392017
- UTU thesis, extrinsic rewards meta-analysis — https://www.utupub.fi/handle/10024/173853
- Franken et al., "Kudos make you run!" — https://doi.org/10.1016/j.socnet.2022.10.001
- Nottingham, scarcity field experiment — https://research.nottingham.edu.cn/en/publications/how-does-scarcity-promotion-lead-to-impulse-purchase-in-the-onlin/
- Luo, Lu & Li, scarcity vs price (ISR) — https://ideas.repec.org/a/inm/orisre/v30y2019i4p1203-1227.html
- Dutch Opera social proof/scarcity (ICORIA) — https://ris.utwente.nl/ws/files/13753628/ICORIA_2017_paper_40.pdf
- LQS/LTS + social cues — https://www.sciencedirect.com/science/article/abs/pii/S1447677021000437
- Strava engineering, club leaderboards — https://medium.com/strava-engineering/scaling-club-leaderboard-infrastructure-for-millions-of-users-9ee857ce8cfe
- Strava engineering, activity grouping — https://medium.com/strava-engineering/activity-grouping-the-heart-of-a-social-network-for-athletes-865751f7dca
- Chess.com clubs — https://support.chess.com/en/articles/8718710-how-do-chess-com-clubs-work
- Chess.com club admins FAQ — https://support.chess.com/en/articles/10198889-club-admins-faq
- Playtomic Global Padel Report 2025 — https://8258038.fs1.hubspotusercontent-na1.net/hubfs/8258038/Global%20Padel%20Report/PLAYTOMIC_GLOBAL%20_PADEL_REPORT_2025.pdf
- Playtomic Global Padel Report 2026 (landing) — https://playtomic.com/global-padel-report
- CleverTap push report — https://clevertap.com/blog/push-notification-report/
- Airship push benchmarks 2025 — https://growth.airship.com/rs/313-QPJ-195/images/Airship-2025-Push-Notification-Benchmarks-EN.pdf
- Business of Apps, push deliverability — https://www.businessofapps.com/insights/removing-the-obstacles-to-a-successful-push-notification-campaign/
- Socialcam (AllThingsD 2012) — https://allthingsd.com/20120516/socialcam-facebook-viddy/
- Socialcam post-mortem (secondary) — https://unicornburn.com/autopsy/socialcam-mobile-video-usa
- Perkins v. LinkedIn settlement notice — https://digitalcommons.law.scu.edu/historical/1059
- Guardian, LinkedIn settlement — https://www.theguardian.com/technology/2015/oct/07/linkedin-lawsuit-add-connection-feature
- ScreensDesign, invite-to-unlock (secondary) — https://screensdesign.com/showcase/umax-become-hot
- Yu-kai Chou, onboarding design (secondary) — https://yukaichou.com/gamification-analysis/onboarding-design-gamification-first-five-minutes/
