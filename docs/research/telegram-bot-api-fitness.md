# Telegram Bot API fitness for Convocados transactional notifications

Research question: can a Telegram bot serve as Convocados' third notification channel — server-initiated transactional DMs (game reminders, cancellations, payment nudges) — reliably and for free?

All sources are primary (core.telegram.org / telegram.org), accessed **2026-08-25**.

## Feasibility verdict

**Yes — fit for purpose.** Server-initiated DMs via `sendMessage(chat_id, text)` are free, require no template approval, no app review, and no per-message cost at Convocados' scale (a team of ~20 players × reminders is orders of magnitude below the ~30 msg/s free broadcast ceiling). The one hard constraint is opt-in mechanics: a bot cannot message a user who has never pressed Start, so Telegram must be positioned as an *additional* opt-in channel alongside email/push, never the sole channel. Reliability for time-critical reminders is good but not guaranteed-delivery: Telegram confirms API acceptance, not user read; blocked-bot users return 403 and must be suppressed. Richness (inline buttons, HTML formatting, per-user i18n) exceeds what we get from email.

## Costs & limits

- **No cost.** Bot FAQ states plainly: "By default, bots are able to message their users **at no cost**" ([Bots FAQ — Broadcasting to Users](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this), accessed 2026-08-25).
- **No template approval / no review.** Unlike WhatsApp Business or FCM-with-review flows, nothing in the [Bot API reference](https://core.telegram.org/bots/api) (accessed 2026-08-25) or the [Bot Developer Terms](https://telegram.org/tos/bot-developers) requires pre-approval of message content. A bot token from [@BotFather](https://core.telegram.org/bots/features#botfather) is the only credential needed. The 2024–2026 changelog ([Bot API recent changes](https://core.telegram.org/bots/api#recent-changes)) introduces paid broadcasts (Oct 2024), rich messages, ephemeral messages, communities (2026) — **no policy change restricting notification-style bots**.
- **Rate limits** ([Bots FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)):
  - Single chat: avoid more than **1 msg/sec** per chat (short bursts tolerated, then HTTP 429).
  - Groups: 20 msg/min per group.
  - Global bulk broadcast: ~**30 messages/sec** across all chats.
  - Paid broadcasts (opt-in): up to 1000 msg/s at **0.1 Stars/msg over the free 30/s**, gated behind ≥100k Stars balance + ≥100k MAU ([FAQ](https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-39s-subscribers-at-once); [Bot Developer Terms §6.2.5](https://telegram.org/tos/bot-developers#6-2-5-broadcasting-messages-with-stars)). Irrelevant for us — a reminder sweep for even 10k users at 30/s finishes in ~6 minutes.
- `sendMessage` itself: `chat_id` + `text` (1–4096 chars) required; optional `parse_mode`, `disable_notification`, `protect_content`, `reply_markup` ([sendMessage reference](https://core.telegram.org/bots/api#sendmessage)).

## Connect flow

Confirmed shape, straight from primary docs:

1. **Deep link**: `https://t.me/<bot_username>?start=<token>`. Payload charset limited to `A-Z a-z 0-9 _ -`, max **64 chars**, base64url recommended for binary content ([Bot Features — Deep Linking](https://core.telegram.org/bots/features#deep-linking)). When the user opens the chat and presses Start, the bot receives the message `/start <token>`.
2. **Binding**: bot receives an `Update` with `message.chat.id` (= stable integer `chat_id` for the private chat, fits in signed 64-bit) and `message.from.id` / `from.language_code` ([Update](https://core.telegram.org/bots/api#update), [Chat](https://core.telegram.org/bots/api#chat)). Updates arrive via long polling (`getUpdates`) or webhook (`setWebhook`, mutually exclusive; pending updates kept server-side ≤24h).
3. **Bind payload design**: put a short opaque one-time token in `?start=` (e.g. base64url of a random id stored in our DB against the web-app userId), not the userId itself — 64-char cap and don't-leak-userids both point that way. Server looks up token → marks `userId ↔ chat_id` link.
   64-char budget fits e.g. a 32-byte base64url nonce (43 chars) comfortably.
4. **Unbind detection**: subscribe to `my_chat_member` updates — in private chats this fires when the user blocks/unblocks the bot ([Update](https://core.telegram.org/bots/api#update)). Block → mark link inactive immediately.

## Reliability

Honest picture for time-critical reminders:

- **API-side semantics**: `sendMessage` returns the sent `Message` once accepted by Telegram's servers. There is **no documented end-to-end delivery receipt** — no read receipts, no per-message delivery status endpoint. Errors surface synchronously: HTTP 429 with `ResponseParameters.retry_after` seconds on flood control; **403 Forbidden "bot was blocked by the user"**; 400 "chat not found" for never-started/deleted links ([Making requests](https://core.telegram.org/bots/api#making-requests), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters)).
- **Retry semantics**: Telegram does **not** retry failed outgoing sends on our behalf — retry logic is ours (respect `retry_after`). For *incoming* webhooks Telegram retries non-2xx responses "and give[s] up after a reasonable amount of attempts" ([setWebhook](https://core.telegram.org/bots/api#setwebhook)).
- **User never opened the chat / blocked the bot**: bots cannot initiate conversations — if the user has never pressed Start, sends fail with 400; if they later block, 403 on every send. Both are detectable and should feed a suppression state machine (`active → blocked → unblocked`) driven by error codes + `my_chat_member`.
- **Silent send option**: `disable_notification: true` sends with "no sound" — right default for payment nudges; keep sound on for 2h game reminders ([sendMessage](https://core.telegram.org/bots/api#sendmessage)).
- **Practical verdict**: delivery latency once accepted is effectively instant push (Telegram's core product), but treat the channel as best-effort: schedule sends ahead, retry on 429/network, degrade gracefully to email/push when 403/400. For a 2h-before-game reminder this is more than adequate.

## Richness

- **Inline keyboards** ([InlineKeyboardMarkup](https://core.telegram.org/bots/api#inlinekeyboardmarkup), [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton)): URL buttons open any `HTTP(S)` or `tg://` link — perfect tap-through to Convocados event pages or back into a deep link. Also `callback_data` (1–64 bytes) for in-chat actions ("I'm in"), and `web_app` buttons launching a Mini App (private chats only). Note: clients show an "Open this link?" confirmation alert before opening inline links ([Formatting options](https://core.telegram.org/bots/api#formatting-options)).
- **Formatting**: `parse_mode` = `HTML` or `MarkdownV2` (bold, italic, underline, strikethrough, spoiler, code, blockquotes, inline links) or raw `entities` array ([Formatting options](https://core.telegram.org/bots/api#formatting-options)). New in 2026: structured [Rich Messages](https://core.telegram.org/bots/api#rich-messages) (`sendRichMessage`, tables/lists/collages) — optional future upgrade, plain HTML is enough for notifications.
- **i18n**: `User.language_code` arrives as an IETF tag on every update; commands support per-language scopes via `language_code` on `BotCommandScope*`, and the platform explicitly supports multi-language bots that adapt to user language settings ([User](https://core.telegram.org/bots/api#user); [Bot Features — Language Support / Command Scopes](https://core.telegram.org/bots/features#commands)). Maps cleanly onto Convocados' existing 6-locale i18n.

## Policy

- **Telegram ToS (user-level)**: prohibits using the service to "send spam or scam users" ([Telegram ToS](https://telegram.org/tos)). Fine — our messages go only to opted-in linked users about events they joined.
- **[Bot Developer Terms of Service](https://telegram.org/tos/bot-developers)** (binding on us as developers):
  - §5.2(b): TPA "must not harass or spam users with unsolicited messages". Transactional reminders to players of their own games are solicited/opt-in — compliant by construction; keep frequency sane and provide an opt-out command.
  - §5.2(f): must not circumvent rate limits/moderation.
  - §4: every bot needs an accessible privacy policy; Telegram's [Standard Privacy Policy for Bots and Mini Apps](https://telegram.org/privacy-tpa) applies by default but we should ship our own since we store `chat_id` mapped to account data. §4.2: delete user data on request and when no longer needed. §9.1 explicitly names GDPR as the developer's responsibility.
  - Nothing restricts notification/transactional bots as a category. No review gate exists beyond ToS compliance enforced after the fact.
- **GDPR angle of storing `chat_id`**: the integer `chat_id` is personal data (persistent identifier linking to an individual). Requirements for Convocados (EU-facing):
  - Lawful basis: consent captured at the moment the user presses the deep-link Start button (clearly labeled "connect Telegram notifications"), revocable anytime via `/unlink` in-chat or web settings.
  - Store minimal data: `chat_id` + language_code; do not hoard profile fields.
  - Honor erasure (Art. 17): deleting the link + chat_id on request satisfies it; document this in the privacy policy per Bot Developer Terms §4.
  - Data-minimization bonus: Telegram shares only what's listed in its Privacy Policy §6.3 ("What Data Bots Receive").
- **Token hygiene**: the bot token authenticates everything — keep it server-side only, use webhook `secret_token` header verification ([setWebhook](https://core.telegram.org/bots/api#setwebhook)).
