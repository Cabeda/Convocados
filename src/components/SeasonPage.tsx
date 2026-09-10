/* eslint-disable react-hooks/set-state-in-effect -- Async server data initializes local form state. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress, Container,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import RecommendIcon from "@mui/icons-material/Recommend";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DragHandleIcon from "@mui/icons-material/DragHandle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import CancelIcon from "@mui/icons-material/Cancel";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import CrewProposalPanel from "./CrewProposalPanel";
import { LeaderboardTables, type LeaderboardPayload } from "./LeaderboardTables";
import { SeasonRankTable } from "./SeasonRankTable";

interface Member {
  membershipId: string;
  eventPlayerId: string;
  name: string;
  rating: number;
  crewId: string | null;
}

interface CrewDraft {
  id?: string;
  name: string;
  membershipIds: string[];
}

interface PublicCrew {
  id?: string;
  name: string;
  sortOrder: number;
  members: Array<{ name: string; membershipId?: string }>;
}

interface SeasonPayload {
  id: string;
  name: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  status: string;
  activatedAt?: string | null;
  crews: PublicCrew[];
  activeMembers?: Member[];
  viewerEventPlayerId?: string | null;
  viewerMembership?: { id: string; status: string; eventPlayerId: string } | null;
  registrationOpen?: boolean;
  leaderboard?: LeaderboardPayload | null;
}

interface MemberCandidate {
  eventPlayerId: string;
  name: string;
  hasAccount: boolean;
  gamesPlayed: number;
  memberStatus: string | null;
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

export default function SeasonPage({ eventId, seasonId, crewInviteToken }: { eventId: string; seasonId: string; crewInviteToken?: string }) {
  const t = useT();
  const inviteClaimAttemptedRef = useRef(false);
  const setupDraftDirtyRef = useRef(false);
  const [season, setSeason] = useState<SeasonPayload | null>(null);
  const [seasonName, setSeasonName] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardPayload | null>(null);
  const [crewCount, setCrewCount] = useState(2);
  const [crews, setCrews] = useState<CrewDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"recommend" | "save" | "membership" | "activate" | "bulk" | "enroll" | "details" | "remove" | "crewDelete" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const candidatesLoadedRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingMembershipId, setDraggingMembershipId] = useState<string | null>(null);
  const [pendingCrewDelete, setPendingCrewDelete] = useState<{ index: number; id?: string; name: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = crewInviteToken ? `?crewInviteToken=${encodeURIComponent(crewInviteToken)}` : "";
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(response.status === 401 ? t("seasonSignInRequired") : data.error ?? t("somethingWentWrong"));
        return;
      }
      const nextSeason = data.season as SeasonPayload;
      setSeason(nextSeason);
      setSeasonName(nextSeason.name);
      setOpensAt(toDateInput(nextSeason.registrationOpensAt));
      setClosesAt(toDateInput(nextSeason.registrationClosesAt));
      setLeaderboard(nextSeason.leaderboard ?? null);
      if (nextSeason.activeMembers) {
        const nextCrews = nextSeason.crews.map((crew) => ({
          id: crew.id,
          name: crew.name,
          membershipIds: crew.members.map((member) => member.membershipId).filter((id): id is string => !!id),
        }));
        setCrews(nextCrews);
        setCrewCount(Math.max(2, nextCrews.length || 2));
      }
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }, [crewInviteToken, eventId, seasonId, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!crewInviteToken || inviteClaimAttemptedRef.current) return;
    inviteClaimAttemptedRef.current = true;
    const controller = new AbortController();
    void fetch(`/api/events/${eventId}/seasons/${seasonId}/crew-proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim-invite", token: crewInviteToken }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok && response.status !== 401) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? t("somethingWentWrong"));
      }
      await load();
    }).catch((claimError: unknown) => {
      if (claimError instanceof DOMException && claimError.name === "AbortError") return;
      setError(t("somethingWentWrong"));
    });
    return () => controller.abort();
  }, [crewInviteToken, eventId, load, seasonId, t]);

  const members = season?.activeMembers ?? [];
  // The GET returns activeMembers only to owners/admins, so their presence is
  // the admin signal — admins keep management access after activation too.
  const isManager = !!season?.activeMembers;
  const isRegistration = season?.status === "registration";
  const isTerminal = season?.status === "completed" || season?.status === "cancelled";
  // Admins may edit Crews at any non-terminal stage (registration, active,
  // review); completed and cancelled Seasons are read-only for everyone.
  const isAdmin = isManager && !isTerminal;
  const isRegistrationOpen = season?.registrationOpen ?? false;
  const isSeasonMember = season?.viewerMembership?.status === "active";
  const assignedIds = useMemo(() => new Set(crews.flatMap((crew) => crew.membershipIds)), [crews]);
  const unassigned = members.filter((member) => !assignedIds.has(member.membershipId));

  const savedCrews = season?.crews ?? [];
  const qualifyingCrewCount = savedCrews.filter((crew) => crew.members.length >= 3 && crew.members.length <= 5).length;
  const activationReady = qualifyingCrewCount >= 3 && members.length >= 9;

  const recommend = async () => {
    setBusy("recommend");
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/crews/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewCount }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("somethingWentWrong")); return; }
      setupDraftDirtyRef.current = true;
      setCrews(data.crews.map((crew: { name: string; membershipIds: string[] }) => ({
        name: crew.name,
        membershipIds: crew.membershipIds,
      })));
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/crews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crews }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonSetupError")); return; }
      setSaved(true);
      await load();
      setupDraftDirtyRef.current = false;
    } catch {
      setError(t("seasonSetupError"));
    } finally {
      setBusy(null);
    }
  };

  const saveDetails = async () => {
    setBusy("details");
    setError(null);
    setSaved(false);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          name: seasonName,
          registrationOpensAt: opensAt,
          registrationClosesAt: closesAt,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonDetailsError")); return; }
      const updated = data.season as { name: string; registrationOpensAt: string; registrationClosesAt: string };
      setSeason((current) => current ? {
        ...current,
        name: updated.name,
        registrationOpensAt: updated.registrationOpensAt,
        registrationClosesAt: updated.registrationClosesAt,
      } : current);
      setSeasonName(updated.name);
      setOpensAt(toDateInput(updated.registrationOpensAt));
      setClosesAt(toDateInput(updated.registrationClosesAt));
      setNotice(t("seasonDetailsSaved"));
    } catch {
      setError(t("seasonDetailsError"));
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: Member) => {
    setBusy("remove");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/memberships/${member.membershipId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonMembershipError")); return; }
      // Drop the member from every draft crew, then refresh participants.
      setCrews((current) => current.map((crew) => ({
        ...crew,
        membershipIds: crew.membershipIds.filter((id) => id !== member.membershipId),
      })));
      setCandidates((current) => current.filter((entry) => entry.eventPlayerId !== member.eventPlayerId));
      setNotice(t("memberRemoved", { name: member.name }));
      await refreshMembers();
    } catch {
      setError(t("seasonMembershipError"));
    } finally {
      setBusy(null);
    }
  };

  const confirmCrewDelete = async () => {
    if (!pendingCrewDelete) return;
    const { index, id, name } = pendingCrewDelete;
    setBusy("crewDelete");
    setError(null);
    setNotice(null);
    try {
      if (id) {
        const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/crews/${id}`, { method: "DELETE" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { setError(data.error ?? t("crewDeleteError")); return; }
      }
      setCrews((current) => current.filter((_, crewIndex) => crewIndex !== index));
      setPendingCrewDelete(null);
      setNotice(t("crewDeleted", { name }));
      if (id) await refreshMembers();
    } catch {
      setError(t("crewDeleteError"));
    } finally {
      setBusy(null);
    }
  };

  const confirmCancelSeason = async () => {
    setBusy("cancel");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonCancelError")); return; }
      setCancelOpen(false);
      setCancelReason("");
      await load();
    } catch {
      setError(t("seasonCancelError"));
    } finally {
      setBusy(null);
    }
  };

  const activate = async () => {
    setBusy("activate");
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonActivateError")); return; }
      await load();
    } catch {
      setError(t("seasonActivateError"));
    } finally {
      setBusy(null);
    }
  };

  const updateMembership = async (join: boolean) => {
    if (!season?.viewerEventPlayerId) return;
    setBusy("membership");
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/membership`, {
        method: join ? "POST" : "DELETE",
        ...(join ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventPlayerId: season.viewerEventPlayerId }),
        } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonMembershipError")); return; }
      await load();
    } catch {
      setError(t("seasonMembershipError"));
    } finally {
      setBusy(null);
    }
  };

  // Refresh the participant list without touching unsaved Crew drafts.
  const refreshMembers = async () => {
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      const nextSeason = data.season as SeasonPayload;
      setSeason((current) => current ? { ...current, activeMembers: nextSeason.activeMembers } : nextSeason);
    } catch {
      // Non-fatal: the next load covers it.
    }
  };

  const bulkAddMembers = async () => {
    setBusy("bulk");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/memberships/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonMembershipError")); return; }
      const added = Array.isArray(data.added) ? data.added : [];
      const skipped = Array.isArray(data.skipped) ? data.skipped : [];
      if (added.length === 0 && skipped.length === 0) {
        setNotice(t("recentPlayersNone"));
      } else {
        const parts = added.length > 0 ? [t("recentPlayersAdded", { added: added.length })] : [];
        if (skipped.length > 0) {
          parts.push(t("recentPlayersSkipped", {
            skipped: skipped.length,
            names: skipped.map((entry: { name: string }) => entry.name).join(", "),
          }));
        }
        setNotice(parts.join(" "));
      }
      await refreshMembers();
    } catch {
      setError(t("seasonMembershipError"));
    } finally {
      setBusy(null);
    }
  };

  const loadCandidates = async () => {
    if (candidatesLoadedRef.current) return;
    candidatesLoadedRef.current = true;
    try {
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/memberships/candidates`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setCandidates(Array.isArray(data.players) ? data.players : []);
    } catch {
      // Non-fatal: the autocomplete simply stays empty.
    }
  };

  const enrollMember = async (eventPlayerId: string, crewIndex: number | null) => {
    setBusy("enroll");
    setError(null);
    setNotice(null);
    try {
      const draftCrew = crewIndex === null ? null : crews[crewIndex] ?? null;
      const response = await fetch(`/api/events/${eventId}/seasons/${seasonId}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventPlayerId, crewId: draftCrew?.id ?? null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? t("seasonMembershipError")); return; }
      const membershipId = (data.membership as { id?: unknown } | undefined)?.id;
      const candidate = candidates.find((entry) => entry.eventPlayerId === eventPlayerId);
      const displayName = candidate?.name ?? "";
      setCandidates((current) => current.filter((entry) => entry.eventPlayerId !== eventPlayerId));
      if (typeof membershipId === "string" && crewIndex !== null) moveMember(membershipId, crewIndex);
      setNotice(draftCrew
        ? t("playerAddedToCrew", { name: displayName, crew: draftCrew.name })
        : t("playerAddedUnassigned", { name: displayName }));
      await refreshMembers();
    } catch {
      setError(t("seasonMembershipError"));
    } finally {
      setBusy(null);
    }
  };

  const rename = (index: number, name: string) => {
    setupDraftDirtyRef.current = true;
    setCrews((current) => current.map((crew, crewIndex) => crewIndex === index ? { ...crew, name } : crew));
  };

  const moveMember = (membershipId: string, crewIndex: number | null) => {
    setupDraftDirtyRef.current = true;
    setCrews((current) => current.map((crew, index) => ({
      ...crew,
      membershipIds: [
        ...(index === crewIndex ? [membershipId] : []),
        ...crew.membershipIds.filter((id) => id !== membershipId),
      ],
    })));
  };

  const addCrew = () => {
    setupDraftDirtyRef.current = true;
    setCrews((current) => {
      const taken = new Set(current.map((crew) => crew.name.toLowerCase()));
      let index = current.length + 1;
      let name = `Crew ${index}`;
      while (taken.has(name.toLowerCase())) {
        index += 1;
        name = `Crew ${index}`;
      }
      return [...current, { name, membershipIds: [] }];
    });
  };

  const dropOnCrew = (crewIndex: number | null) => {
    if (draggingMembershipId === null) return;
    moveMember(draggingMembershipId, crewIndex);
    setDraggingMembershipId(null);
  };

  if (loading) {
    return <ThemeModeProvider><ResponsiveLayout><Container maxWidth="md" sx={{ py: 5, textAlign: "center" }}><CircularProgress /></Container></ResponsiveLayout></ThemeModeProvider>;
  }
  if (!season) {
    return <ThemeModeProvider><ResponsiveLayout><Container maxWidth="md" sx={{ py: 4 }}><Alert severity="error">{error ?? t("somethingWentWrong")}</Alert></Container></ResponsiveLayout></ThemeModeProvider>;
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex" }}>
              <Button variant="outlined" size="small" startIcon={<ArrowBackIcon />} href={`/events/${eventId}/seasons`}>
                {t("backToSeasons")}
              </Button>
            </Box>
            <Box>
              <Typography variant="h4" component="h1" fontWeight={700}>{season.name}</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {isRegistration
                  ? t("seasonSetupDescription")
                  : isAdmin
                    ? t("seasonAdminEditDescription")
                    : t("seasonReadOnlyDescription")}
              </Typography>
            </Box>

            {isManager && (
              <Card variant="outlined">
                <CardContent>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between" }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {isRegistration ? t("seasonStartTitle") : t("seasonActiveTitle")}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {isRegistration
                          ? t("seasonStartRequirements", { crews: qualifyingCrewCount, participants: members.length })
                          : t("seasonActiveDescription")}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button variant="outlined" component="a" href={`/events/${eventId}/history`}>
                        {t("viewHistory")}
                      </Button>
                      {isRegistration && (
                        <Button
                          variant="contained"
                          onClick={() => void activate()}
                          disabled={busy !== null || !activationReady}
                        >
                          {busy === "activate" ? t("startingSeason") : t("startSeason")}
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
            {saved && <Alert severity="success">{t("seasonSaved")}</Alert>}
            {notice && <Alert severity="info" onClose={() => setNotice(null)}>{notice}</Alert>}
            {season.viewerEventPlayerId && isRegistrationOpen && (
              <Button
                variant={isSeasonMember ? "outlined" : "contained"}
                onClick={() => void updateMembership(!isSeasonMember)}
                disabled={busy !== null}
              >
                {busy === "membership"
                  ? (isSeasonMember ? t("leavingSeason") : t("joiningSeason"))
                  : (isSeasonMember ? t("leaveSeason") : t("joinSeason"))}
              </Button>
            )}
            {season.status === "registration" && <CrewProposalPanel eventId={eventId} seasonId={seasonId} onCrewApproved={() => setupDraftDirtyRef.current ? undefined : load()} />}

            <LeaderboardTables
              data={leaderboard}
              loading={false}
              selectedScopeId={seasonId}
              seasonOptions={[]}
              onScopeChange={() => {}}
              eventId={eventId}
              showPlayers={false}
            />

            {(season.status === "active" || season.status === "review" || season.status === "completed") && (
              <SeasonRankTable eventId={eventId} seasonId={seasonId} standings={leaderboard?.players} />
            )}

            {!isAdmin ? (
              <Stack spacing={2}>
                <Typography variant="h6">{t("season")}</Typography>
                {season.crews.length === 0 ? <Alert severity="info">{t("seasonNoCrews")}</Alert> : season.crews.map((crew) => (
                  <Card key={`${crew.name}-${crew.sortOrder}`} variant="outlined"><CardContent>
                    <Typography variant="h6">{crew.name}</Typography>
                    <Typography color="text.secondary">{crew.members.map((member) => member.name).join(", ")}</Typography>
                  </CardContent></Card>
                ))}
              </Stack>
            ) : (
              <Stack spacing={3}>
                <Card variant="outlined"><CardContent>
                  <Stack spacing={2}>
                    <Typography variant="subtitle1" fontWeight={700}>{t("seasonDetails")}</Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", sm: "flex-end" } }}>
                      <TextField
                        label={t("seasonNameLabel")} value={seasonName}
                        onChange={(event) => setSeasonName(event.target.value)}
                        fullWidth size="small"
                      />
                      <TextField
                        type="date" label={t("registrationOpensAt")} value={opensAt}
                        onChange={(event) => setOpensAt(event.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }} fullWidth size="small"
                      />
                      <TextField
                        type="date" label={t("registrationClosesAt")} value={closesAt}
                        onChange={(event) => setClosesAt(event.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }} fullWidth size="small"
                      />
                      <Button variant="outlined" onClick={() => void saveDetails()} disabled={busy !== null} sx={{ whiteSpace: "nowrap" }}>
                        {busy === "details" ? t("savingDetails") : t("saveDetails")}
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent></Card>
                <Card variant="outlined"><CardContent>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", sm: "flex-end" } }}>
                    <FormControl sx={{ minWidth: { sm: 180 } }}>
                      <InputLabel id="season-crew-count-label">{t("crewCount")}</InputLabel>
                      <Select labelId="season-crew-count-label" label={t("crewCount")} value={crewCount} onChange={(event) => {
                        setupDraftDirtyRef.current = true;
                        setCrewCount(Number(event.target.value));
                      }}>
                        {Array.from({ length: Math.max(6, Math.ceil(members.length / 3)) - 1 }, (_, index) => index + 2).map((count) => <MenuItem key={count} value={count}>{count}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <Button variant="outlined" startIcon={<RecommendIcon />} onClick={() => void recommend()} disabled={busy !== null}>
                      {busy === "recommend" ? t("recommendingCrews") : t("recommendCrews")}
                    </Button>
                  </Stack>
                </CardContent></Card>

                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="h6" gutterBottom sx={{ mb: 0 }}><GroupsIcon sx={{ verticalAlign: "middle", mr: 0.5 }} />{t("crewMembers")}</Typography>
                    <Button variant="outlined" size="small" startIcon={<PersonAddIcon />} onClick={() => void bulkAddMembers()} disabled={busy !== null}>
                      {busy === "bulk" ? t("addingRecentPlayers") : t("addRecentPlayers")}
                    </Button>
                  </Stack>
                  <Stack spacing={2} sx={{ mt: 2 }}>
                    {crews.map((crew, index) => {
                      const crewMembers = crew.membershipIds
                        .map((membershipId) => members.find((candidate) => candidate.membershipId === membershipId))
                        .filter((member): member is Member => !!member);
                      const crewElo = crewMembers.length > 0
                        ? Math.round(crewMembers.reduce((sum, member) => sum + member.rating, 0) / crewMembers.length)
                        : null;
                      return (
                        <Card
                          key={crew.id ?? `new-${crew.name}`}
                          variant="outlined"
                          data-testid={`crew-card-${index}`}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => dropOnCrew(index)}
                        >
                          <CardContent>
                            <Stack spacing={1.5}>
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                <TextField label={t("crewName")} value={crew.name} onChange={(event) => rename(index, event.target.value)} size="small" sx={{ flex: 1 }} />
                                {crewElo !== null && <Chip size="small" color="secondary" variant="outlined" label={`${t("crewElo")} ${crewElo}`} />}
                                <IconButton
                                  size="small"
                                  color="error"
                                  aria-label={t("deleteCrewAria", { name: crew.name })}
                                  onClick={() => setPendingCrewDelete({ index, id: crew.id, name: crew.name })}
                                  disabled={busy !== null}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                              {crew.membershipIds.map((membershipId) => {
                                const member = members.find((candidate) => candidate.membershipId === membershipId);
                                if (!member) return null;
                                return <MemberAssignment key={membershipId} member={member} crews={crews} currentCrewIndex={index} onMove={moveMember} onDragStart={() => setDraggingMembershipId(member.membershipId)} onDragEnd={() => setDraggingMembershipId(null)} onRemove={() => void removeMember(member)} disabled={busy !== null} />;
                              })}
                              <CrewMemberAutocomplete
                                label={t("addPlayerToCrew", { crew: crew.name })}
                                candidates={candidates.filter((candidate) => candidate.memberStatus !== "active")}
                                disabled={busy !== null}
                                onOpen={() => void loadCandidates()}
                                onSelect={(eventPlayerId) => void enrollMember(eventPlayerId, index)}
                              />
                            </Stack>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Stack>
                  <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addCrew} disabled={busy !== null} sx={{ mt: 2 }}>
                    {t("addCrew")}
                  </Button>
                </Box>

                {unassigned.length > 0 && (
                  <Card
                    variant="outlined"
                    data-testid="unassigned-card"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropOnCrew(null)}
                  >
                    <CardContent>
                      <Typography variant="subtitle1" fontWeight={600}>{t("unassignedPlayers")}</Typography>
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        {unassigned.map((member) => <MemberAssignment key={member.membershipId} member={member} crews={crews} currentCrewIndex={null} onMove={moveMember} onDragStart={() => setDraggingMembershipId(member.membershipId)} onDragEnd={() => setDraggingMembershipId(null)} onRemove={() => void removeMember(member)} disabled={busy !== null} />)}
                      </Stack>
                      <CrewMemberAutocomplete
                        label={t("addPlayer")}
                        candidates={candidates.filter((candidate) => candidate.memberStatus !== "active")}
                        disabled={busy !== null}
                        onOpen={() => void loadCandidates()}
                        onSelect={(eventPlayerId) => void enrollMember(eventPlayerId, null)}
                      />
                    </CardContent>
                  </Card>
                )}

                <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={() => void save()} disabled={busy !== null || crews.length < 2}>
                  {busy === "save" ? t("savingCrews") : t("saveCrews")}
                </Button>

                <Box>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<CancelIcon />}
                    onClick={() => { setCancelReason(""); setCancelOpen(true); }}
                    disabled={busy !== null}
                  >
                    {t("cancelSeason")}
                  </Button>
                </Box>
              </Stack>
            )}
          </Stack>
        </Container>

        <Dialog open={pendingCrewDelete !== null} onClose={() => busy === null && setPendingCrewDelete(null)}>
          <DialogTitle>{t("deleteCrewTitle")}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t("deleteCrewConfirm", { name: pendingCrewDelete?.name ?? "" })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingCrewDelete(null)} disabled={busy !== null}>{t("cancel")}</Button>
            <Button color="error" variant="contained" onClick={() => void confirmCrewDelete()} disabled={busy !== null}>
              {busy === "crewDelete" ? t("deletingCrew") : t("deleteCrew")}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={cancelOpen} onClose={() => busy === null && setCancelOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>{t("cancelSeasonTitle")}</DialogTitle>
          <DialogContent>
            <DialogContentText>{t("cancelSeasonConfirm")}</DialogContentText>
            <TextField
              autoFocus
              margin="dense"
              label={t("cancelSeasonReason")}
              fullWidth
              size="small"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCancelOpen(false)} disabled={busy !== null}>{t("keepSeason")}</Button>
            <Button color="error" variant="contained" onClick={() => void confirmCancelSeason()} disabled={busy !== null}>
              {busy === "cancel" ? t("cancellingSeason") : t("cancelSeason")}
            </Button>
          </DialogActions>
        </Dialog>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}

function MemberAssignment({ member, crews, currentCrewIndex, onMove, onDragStart, onDragEnd, onRemove, disabled }: {
  member: Member;
  crews: CrewDraft[];
  currentCrewIndex: number | null;
  onMove: (membershipId: string, crewIndex: number | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center" }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid={`member-row-${member.membershipId}`}
    >
      <DragHandleIcon fontSize="small" sx={{ cursor: "grab", color: "text.disabled", flexShrink: 0 }} data-testid={`member-grip-${member.membershipId}`} />
      <Typography sx={{ flex: 1 }}>{member.name}</Typography>
      <Chip size="small" variant="outlined" label={Math.round(member.rating)} />
      <FormControl size="small" sx={{ minWidth: 135 }}>
        <Select
          aria-label={t("crewForMember", { name: member.name })}
          value={currentCrewIndex ?? "unassigned"}
          onChange={(event) => onMove(member.membershipId, event.target.value === "unassigned" ? null : Number(event.target.value))}
        >
          <MenuItem value="unassigned">{t("unassigned")}</MenuItem>
          {crews.map((crew, index) => <MenuItem key={crew.id ?? crew.name} value={index}>{crew.name}</MenuItem>)}
        </Select>
      </FormControl>
      {onRemove && (
        <IconButton
          size="small"
          aria-label={t("removeMemberFromSeason", { name: member.name })}
          onClick={onRemove}
          disabled={disabled}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      )}
    </Stack>
  );
}

function CrewMemberAutocomplete({ label, candidates, disabled, onOpen, onSelect }: {
  label: string;
  candidates: MemberCandidate[];
  disabled: boolean;
  onOpen: () => void;
  onSelect: (eventPlayerId: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState<MemberCandidate | null>(null);
  return (
    <Autocomplete
      size="small"
      options={candidates}
      getOptionLabel={(option) => (option.hasAccount ? option.name : `${option.name} ${t("noAccountSuffix")}`)}
      getOptionDisabled={(option) => !option.hasAccount}
      isOptionEqualToValue={(option, selected) => option.eventPlayerId === selected.eventPlayerId}
      value={value}
      disabled={disabled}
      onOpen={onOpen}
      onChange={(_, selected) => {
        if (selected && selected.hasAccount) {
          setValue(null);
          onSelect(selected.eventPlayerId);
        }
      }}
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
      noOptionsText={t("noMatchingPlayers")}
      sx={{ mt: 1 }}
    />
  );
}
