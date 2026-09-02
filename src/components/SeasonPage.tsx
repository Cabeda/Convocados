/* eslint-disable react-hooks/set-state-in-effect -- Async server data initializes local form state. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container,
  FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import RecommendIcon from "@mui/icons-material/Recommend";
import SaveIcon from "@mui/icons-material/Save";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import CrewProposalPanel from "./CrewProposalPanel";

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
  startsAt: string | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  status: string;
  activatedAt?: string | null;
  crews: PublicCrew[];
  activeMembers?: Member[];
  viewerEventPlayerId?: string | null;
  viewerMembership?: { id: string; status: string; eventPlayerId: string } | null;
  registrationOpen?: boolean;
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

export default function SeasonPage({ eventId, seasonId, crewInviteToken }: { eventId: string; seasonId: string; crewInviteToken?: string }) {
  const t = useT();
  const inviteClaimAttemptedRef = useRef(false);
  const setupDraftDirtyRef = useRef(false);
  const [season, setSeason] = useState<SeasonPayload | null>(null);
  const [startDate, setStartDate] = useState("");
  const [crewCount, setCrewCount] = useState(2);
  const [crews, setCrews] = useState<CrewDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"recommend" | "save" | "membership" | "activate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      setStartDate(toDateInput(nextSeason.startsAt));
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
  const isAdmin = isManager && isRegistration;
  const isRegistrationOpen = season?.registrationOpen ?? false;
  const isSeasonMember = season?.viewerMembership?.status === "active";
  const assignedIds = useMemo(() => new Set(crews.flatMap((crew) => crew.membershipIds)), [crews]);
  const unassigned = members.filter((member) => !assignedIds.has(member.membershipId));

  const savedCrews = season?.crews ?? [];
  const qualifyingCrewCount = savedCrews.filter((crew) => crew.members.length >= 3 && crew.members.length <= 5).length;
  const activationReady = qualifyingCrewCount >= 3 && members.length >= 9;
  const leaderboardHref = `/events/${eventId}/history?seasonId=${seasonId}`;

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
        body: JSON.stringify({ startsAt: startDate || null, crews }),
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
            <Box>
              <Typography variant="h4" component="h1" fontWeight={700}>{season.name}</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>{season.status === "registration" ? t("seasonSetupDescription") : t("seasonReadOnlyDescription")}</Typography>
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
                      <Button variant="outlined" component="a" href={leaderboardHref}>
                        {t("viewLeaderboard")}
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
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", sm: "flex-end" } }}>
                    <TextField
                      type="date" label={t("seasonStartDate")} value={startDate}
                      onChange={(event) => {
                        setupDraftDirtyRef.current = true;
                        setStartDate(event.target.value);
                      }}
                      slotProps={{ inputLabel: { shrink: true } }} fullWidth
                    />
                    <FormControl sx={{ minWidth: { sm: 180 } }}>
                      <InputLabel>{t("crewCount")}</InputLabel>
                      <Select label={t("crewCount")} value={crewCount} onChange={(event) => {
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
                  <Typography variant="h6" gutterBottom><GroupsIcon sx={{ verticalAlign: "middle", mr: 0.5 }} />{t("crewMembers")}</Typography>
                  <Stack spacing={2}>
                    {crews.map((crew, index) => (
                      <Card key={crew.id ?? `new-${crew.name}`} variant="outlined">
                        <CardContent>
                          <Stack spacing={1.5}>
                            <TextField label={t("crewName")} value={crew.name} onChange={(event) => rename(index, event.target.value)} size="small" />
                            {crew.membershipIds.map((membershipId) => {
                              const member = members.find((candidate) => candidate.membershipId === membershipId);
                              if (!member) return null;
                              return <MemberAssignment key={membershipId} member={member} crews={crews} currentCrewIndex={index} onMove={moveMember} />;
                            })}
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                </Box>

                {unassigned.length > 0 && (
                  <Card variant="outlined"><CardContent>
                    <Typography variant="subtitle1" fontWeight={600}>{t("unassignedPlayers")}</Typography>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {unassigned.map((member) => <MemberAssignment key={member.membershipId} member={member} crews={crews} currentCrewIndex={null} onMove={moveMember} />)}
                    </Stack>
                  </CardContent></Card>
                )}

                <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={() => void save()} disabled={busy !== null || crews.length < 2}>
                  {busy === "save" ? t("savingCrews") : t("saveCrews")}
                </Button>
              </Stack>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}

function MemberAssignment({ member, crews, currentCrewIndex, onMove }: {
  member: Member;
  crews: CrewDraft[];
  currentCrewIndex: number | null;
  onMove: (membershipId: string, crewIndex: number | null) => void;
}) {
  const t = useT();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
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
    </Stack>
  );
}
