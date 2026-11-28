import type { TFunction } from "./i18n";

export interface PageTitleInput {
  title: string;
  /** The next game's day, already written for the viewer ("Fri 4 Dec"). */
  date: string;
  /** How the viewer's last game ended, when they played it and it has a score: their score first. */
  result: { outcome: "won" | "lost" | "draw"; mine: number; theirs: number } | null;
}

/**
 * What the browser tab (and the history list) says about the page once it is open:
 * "Won 7–6 · Ninjas" after a game the viewer played, "Ninjas · Fri 4 Dec" otherwise.
 * The server's own title stays for search and sharing; this only replaces it in a live tab.
 */
export function pageTitle(i: PageTitleInput, t: TFunction): string {
  if (!i.result) return t("pageTitleNext", { title: i.title, date: i.date });
  const key = i.result.outcome === "won" ? "pageTitleWon" : i.result.outcome === "lost" ? "pageTitleLost" : "pageTitleDraw";
  return t(key, { title: i.title, score: `${i.result.mine}\u2013${i.result.theirs}` });
}
