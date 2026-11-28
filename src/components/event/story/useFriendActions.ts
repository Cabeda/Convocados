import { useCallback, useRef, useState } from "react";
import { useT } from "~/lib/useT";
import { normalizeForMatch } from "~/lib/stringMatch";
import type { AddOutcome, AddOptions } from "./useRosterActions";
import type { useInviteActions } from "./useInviteActions";

export const isEmailLike = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** One person to add: a name, or an email (with an optional name from a contact). */
export interface FriendInput { name?: string; email?: string }

export type FriendResult = { ok: true } | { ok: false; message: string };

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

  const addOne = useCallback(async (input: FriendInput, position?: string, quiet = false): Promise<FriendResult & { name?: string }> => {
    const email = input.email?.trim();
    const typed = (input.name ?? "").trim();
    if (!typed && !email) return { ok: false, message: "" };
    if (email) {
      if (!signedIn) return { ok: false, message: t("ngEmailNeedsSignIn") };
      const label = typed || email.split("@")[0];
      const sent = await invites.inviteByEmail(email, label);
      if (sent === "sent") return { ok: true, name: label };
      if (sent === "failed") return { ok: false, message: t("ngAddError") };
      // Nobody has that email: put them on the list under a name (never the address itself) and email the invitation.
      if (isTaken(label)) return { ok: false, message: t("ngAlreadyIn", { name: label }) };
      const out = await add(label, { linkToAccount: false, email, position, fallback: t("ngAddError") });
      if (!out) return { ok: false, message: "" };
      if (!out.ok) return { ok: false, message: out.message ?? t("ngAddError") };
      if (!quiet) notify(out.invited === "emailed" ? t("ngEmailedRegister", { name: out.resolvedName, email }) : t("ngNoEmailSent", { name: out.resolvedName }));
      return { ok: true, name: out.resolvedName };
    }
    if (isTaken(typed)) return { ok: false, message: t("ngAlreadyIn", { name: typed }) };
    const out = await add(typed, { linkToAccount: false, position, fallback: t("ngAddError") });
    if (!out) return { ok: false, message: "" };
    if (!out.ok) return { ok: false, message: out.message ?? t("ngAddError") };
    // The server may have matched a registered account and used its name: say who was added.
    if (!quiet) notify(t("ngAdded", { name: out.resolvedName }));
    return { ok: true, name: out.resolvedName };
  }, [add, invites, isTaken, notify, signedIn, t]);

  /** One field: an email or a name. */
  const submit = useCallback((text: string, position?: string) => exclusive(() => {
    const value = text.trim();
    return isEmailLike(value) ? addOne({ email: value }, position) : addOne({ name: value }, position);
  }), [addOne, exclusive]);

  /** A list: each line is added in turn. Stops at the first one that cannot be, and says which. */
  const submitMany = useCallback((inputs: readonly FriendInput[]) => exclusive(async () => {
    let added = 0;
    for (const input of inputs) {
      // One summary at the end, not one toast per name waiting in line.
      const out = await addOne(input, undefined, true);
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
    if (!value) return { ok: false, message: "" };
    const email = isEmailLike(value);
    if (email && !signedIn) return { ok: false, message: t("ngEmailNeedsSignIn") };
    const ok = await invites.inviteLink(email ? { email: value } : { name: value }, email ? value.split("@")[0] : value);
    return ok ? { ok: true } : { ok: false, message: t("ngInviteLinkError") };
  }), [exclusive, invites, signedIn, t]);

  return { busy, submit, submitMany, linkFor };
}
