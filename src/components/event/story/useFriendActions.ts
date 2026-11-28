import { useCallback, useRef, useState } from "react";
import { useT } from "~/lib/useT";
import { normalizeForMatch } from "~/lib/stringMatch";
import type { AddOutcome, AddOptions } from "./useRosterActions";
import type { useInviteActions } from "./useInviteActions";

export const isEmailLike = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** One person to add: a name, or an email (with an optional name from a contact). */
export interface FriendInput { name?: string; email?: string }

export type FriendResult =
  | { ok: true }
  | { ok: false; message: string; /** An email nobody has registered: the panel asks who they are before adding. */ needsName?: { email: string } };

interface AddOneOptions {
  position?: string;
  /** No toast of its own: a list says one thing at the end. */
  quiet?: boolean;
  /** An unregistered email with no name: ask (one person) rather than call them "Guest" (a list). */
  ask?: boolean;
  /** The registered-user invite was already tried (the person has just been named). */
  skipInvite?: boolean;
  /** Names handed out earlier in the same list, which the page has not read back yet. */
  used?: Set<string>;
}

interface Args {
  /** The roster add (null when another request is running). */
  add: (name: string, o: AddOptions) => Promise<AddOutcome | null>;
  invites: ReturnType<typeof useInviteActions>;
  signedIn: boolean;
  /** Names already on the list or already invited. */
  takenNames: readonly string[];
  notify: (message: string) => void;
}

/**
 * "Add a friend": a typed name, a typed email, a list, or a link. The decisions live here so the panel only
 * renders: what a bare email means (invite a registered user, or add them and email an invitation to register),
 * what a duplicate is, and what each outcome says in plain words.
 */
export function useFriendActions({ add, invites, signedIn, takenNames, notify }: Args) {
  const t = useT();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);

  const exclusive = useCallback(async <T,>(run: () => Promise<T>): Promise<T | null> => {
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    try { return await run(); } finally { pending.current = false; setBusy(false); }
  }, []);

  const isTaken = useCallback((name: string) => {
    const key = normalizeForMatch(name);
    return takenNames.some((n) => normalizeForMatch(n) === key);
  }, [takenNames]);

  /** "Guest", or "Guest 2", "Guest 3" — never the address, never a name that is already taken. */
  const guestName = useCallback((used: ReadonlySet<string>) => {
    const base = t("ngGuestName");
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base} ${n}`;
      if (!isTaken(candidate) && !used.has(normalizeForMatch(candidate))) return candidate;
    }
  }, [isTaken, t]);

  const addOne = useCallback(async (input: FriendInput, o: AddOneOptions = {}): Promise<FriendResult & { name?: string }> => {
    const email = input.email?.trim();
    const typed = (input.name ?? "").trim();
    const used = o.used ?? new Set<string>();
    if (!typed && !email) return { ok: false, message: "" };
    if (email) {
      if (!signedIn) return { ok: false, message: t("ngEmailNeedsSignIn") };
      if (!o.skipInvite) {
        const sent = await invites.inviteByEmail(email, typed || email);
        if (sent === "sent") return { ok: true, name: typed || email };
        if (typeof sent === "object") return { ok: false, message: sent.failed };
      }
      // Nobody has that email. They go on the list under a name — the one given, or one asked for — never the address.
      if (!typed && o.ask) return { ok: false, message: "", needsName: { email } };
      const label = typed || guestName(used);
      if (isTaken(label) || used.has(normalizeForMatch(label))) return { ok: false, message: t("ngAlreadyIn", { name: label }) };
      const out = await add(label, { linkToAccount: false, email, position: o.position, fallback: t("ngAddError") });
      if (!out) return { ok: false, message: "" };
      if (!out.ok) return { ok: false, message: out.message ?? t("ngAddError") };
      used.add(normalizeForMatch(out.resolvedName));
      if (!o.quiet) notify(out.invited === "emailed" ? t("ngEmailedRegister", { name: out.resolvedName, email }) : t("ngNoEmailSent", { name: out.resolvedName }));
      return { ok: true, name: out.resolvedName };
    }
    if (isTaken(typed) || used.has(normalizeForMatch(typed))) return { ok: false, message: t("ngAlreadyIn", { name: typed }) };
    const out = await add(typed, { linkToAccount: false, position: o.position, fallback: t("ngAddError") });
    if (!out) return { ok: false, message: "" };
    if (!out.ok) return { ok: false, message: out.message ?? t("ngAddError") };
    used.add(normalizeForMatch(out.resolvedName));
    // The server may have matched a registered account and used its name: say who was added.
    if (!o.quiet) notify(t("ngAdded", { name: out.resolvedName }));
    return { ok: true, name: out.resolvedName };
  }, [add, guestName, invites, isTaken, notify, signedIn, t]);

  /** One field: an email or a name. */
  const submit = useCallback((text: string, position?: string) => exclusive(() => {
    const value = text.trim();
    return addOne(isEmailLike(value) ? { email: value } : { name: value }, { position, ask: true });
  }), [addOne, exclusive]);

  /** An email nobody has registered, now with the name the person gave for them. */
  const submitNamedEmail = useCallback((email: string, name: string, position?: string) => exclusive(
    () => addOne({ email, name: name.trim() }, { position, skipInvite: true }),
  ), [addOne, exclusive]);

  /** A list: each line is added in turn. Stops at the first one that cannot be, and says which. */
  const submitMany = useCallback((inputs: readonly FriendInput[]) => exclusive(async () => {
    let added = 0;
    const used = new Set<string>();
    for (const input of inputs) {
      // One summary at the end, not one toast per name waiting in line. A bare email in a list goes on as "Guest".
      const out = await addOne(input, { quiet: inputs.length > 1, used });
      if (!out.ok) {
        const who = input.name ?? input.email ?? "";
        return { added, stoppedAt: inputs.indexOf(input), message: out.message || t("ngAddError"), who };
      }
      added += 1;
    }
    if (added > 1) notify(t("ngAddedMany", { n: added }));
    return { added, stoppedAt: null as number | null, message: "", who: "" };
  }), [addOne, exclusive, notify, t]);

  /** An invite link for whoever is typed, to copy or share instead of adding them. */
  const linkFor = useCallback((text: string) => exclusive(async (): Promise<FriendResult> => {
    const value = text.trim();
    if (!value) return { ok: false, message: t("ngLinkNeedsName") };
    const email = isEmailLike(value);
    if (email && !signedIn) return { ok: false, message: t("ngEmailNeedsSignIn") };
    const made = await invites.inviteLink(email ? { email: value } : { name: value }, value);
    return made === true ? { ok: true } : { ok: false, message: made.failed };
  }), [exclusive, invites, signedIn, t]);

  return { busy, submit, submitNamedEmail, submitMany, linkFor };
}
