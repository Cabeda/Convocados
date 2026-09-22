# Account credential linking and cross-account merge

Users can attach multiple **Credentials** (password, Google) to one **User**; Primary email never changes via OAuth. Google sign-in with no email match still creates a new account (Gmail becomes its Primary email) — splits are possible and recovered by an explicit **merge**: linking a Google credential that already owns a different User absorbs that User into the current session User (interstitial confirm required; transfer all foreign keys; unique collisions and singleton prefs resolve to the survivor; absorbed sessions hard-logout; absorbed Primary email is freed — the Google `sub` is the identity tie-point, not the email). Same-email Google sign-in auto-links silently. Unlink is blocked only when it is the sole Credential. Magic link is a sign-in mechanism, not a revocable Credential row.

## Considered Options

- Abort Google sign-in on email mismatch and force "sign in with password first, then link" — rejected: no recovery path when the user only knows the Google identity; creating-then-merging covers both entry orders.
- Match/merge on email string — rejected: Proton primary and Gmail Google account never share an email; `Account (issuer, accountId)` unique is the real key.
- Field-level merge on collisions (combine follow mutes, sum wallet) — rejected: collisions are rare (two half-accounts of one person); survivor-wins is deterministic and testable.
- Keep absorbed email reserved to block re-registration — rejected: once the Google credential is linked, sign-in hits the credential row, not email lookup; freeing the email is safe.

## Consequences

- Merge is irreversible and deletes a User row — the interstitial confirm (ADR decision, not optional UX polish) is the safety gate.
- Web (`UserProfilePage`) and Android (`ProfileScreen`) ship link/unlink UI in the same PR or an explicitly linked follow-up (platform parity rule).
- `Account @@unique([issuer, accountId])` remains the invariant that forces the merge path on a second link attempt.
