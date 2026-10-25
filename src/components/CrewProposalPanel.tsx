/* eslint-disable react-hooks/set-state-in-effect -- Async server data initializes proposal state. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Autocomplete, Button, Card, CardContent, Chip, Divider, Stack, TextField, Typography,
} from "@mui/material";
import { useT } from "~/lib/useT";
import { apiRequest, ApiError } from "~/lib/api/client";

interface Candidate {
  membershipId?: string;
  eventPlayerId?: string;
  userId?: string | null;
  name: string;
  gamesPlayed?: number;
}

interface Proposal {
  id: string;
  name: string;
  status: string;
  proposerName: string;
  memberNames: string[];
  rejectionReason?: string | null;
}

interface ProposalResponse {
  canPropose: boolean;
  canReview: boolean;
  proposerMembershipId?: string | null;
  candidates: Candidate[];
  excludedUserIds?: string[];
  proposals: Proposal[];
}

function candidateKey(candidate: Candidate) {
  return candidate.userId ? `user:${candidate.userId}` : candidate.membershipId ?? `name:${candidate.name.toLowerCase()}`;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function CrewProposalPanel({
  eventId,
  seasonId,
  onCrewApproved,
}: {
  eventId: string;
  seasonId: string;
  onCrewApproved?: () => Promise<void> | void;
}) {
  const t = useT();
  const [data, setData] = useState<ProposalResponse | null>(null);
  const [externalCandidates, setExternalCandidates] = useState<Candidate[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Candidate[]>([]);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [invited, setInvited] = useState(false);

  const load = useCallback(async () => {
    try {
      let proposalData: ProposalResponse;
      try {
        proposalData = (await apiRequest(
          "GET /api/events/{id}/seasons/{seasonId}/crew-proposals",
          { params: { id: eventId, seasonId } },
        )) as ProposalResponse;
      } catch (loadError) {
        // 401/403 means "no proposal to show", not an error to surface.
        if (loadError instanceof ApiError && (loadError.status === 401 || loadError.status === 403)) return;
        throw loadError instanceof ApiError ? new Error(loadError.message) : loadError;
      }
      setData(proposalData);
      if (proposalData.proposerMembershipId) {
        const proposer = proposalData.candidates.find((candidate) => candidate.membershipId === proposalData.proposerMembershipId);
        if (proposer) setSelectedCandidates((current) => current.length > 0 ? current : [proposer]);
      }
      if (proposalData.canPropose) {
        const coPlayersData = (await apiRequest("GET /api/me/co-players").catch(() => ({}))) as { players?: Array<{ name: string; userId?: string | null; coPlayCount?: number }> };
        const coPlayerCandidates = (coPlayersData.players ?? [])
          .filter((candidate) => candidate.userId)
          .map((candidate) => ({ name: candidate.name, userId: candidate.userId, gamesPlayed: candidate.coPlayCount }));
        setExternalCandidates(coPlayerCandidates);
      }
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t("crewProposalError"));
    }
  }, [eventId, seasonId, t]);

  useEffect(() => { void load(); }, [load]);

  const allCandidates = useMemo(() => {
    const excludedUserIds = new Set(data?.excludedUserIds ?? []);
    const byKey = new Map<string, Candidate>();
    for (const candidate of [...(data?.candidates ?? []), ...externalCandidates]) {
      if (candidate.userId && excludedUserIds.has(candidate.userId) && !candidate.membershipId) continue;
      const key = candidateKey(candidate);
      if (!byKey.has(key)) byKey.set(key, candidate);
    }
    return [...byKey.values()];
  }, [data?.candidates, data?.excludedUserIds, externalCandidates]);

  if (!data || (!data.canPropose && !data.canReview && data.proposals.length === 0)) return null;

  const statusLabel = (status: string) => ({
    pending: t("proposalStatusPending"),
    approved: t("proposalStatusApproved"),
    rejected: t("proposalStatusRejected"),
  }[status] ?? status);

  const addCandidate = (candidate: Candidate) => {
    setSelectedCandidates((current) => current.some((selected) => candidateKey(selected) === candidateKey(candidate)) ? current : [...current, candidate]);
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!isEmail(email)) return;
    setBusy("invite");
    setError(null);
    setInvited(false);
    setInvitedEmail("");
    try {
      const result = (await apiRequest(
        "POST /api/events/{id}/seasons/{seasonId}/crew-proposals",
        { params: { id: eventId, seasonId }, body: { action: "invite", email } },
      )) as { candidate?: Candidate };
      if (result.candidate) {
        const candidate = result.candidate as Candidate;
        setExternalCandidates((current) => [...current, candidate]);
        addCandidate(candidate);
      } else {
        setInvitedEmail(email);
        setInvited(true);
      }
      setInviteEmail("");
    } catch (inviteError) {
      setError(inviteError instanceof ApiError ? inviteError.message : t("crewProposalError"));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("submit");
    setError(null);
    setSubmitted(false);
    try {
      const result = (await apiRequest(
        "POST /api/events/{id}/seasons/{seasonId}/crew-proposals",
        {
          params: { id: eventId, seasonId },
          body: {
            name: name.trim(),
            members: selectedCandidates.map(({ membershipId, userId }) => membershipId ? { membershipId } : { userId: userId ?? undefined }),
          },
        },
      )) as { proposal: Proposal };
      setData((current) => current ? { ...current, proposals: [result.proposal, ...current.proposals] } : current);
      setName("");
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : t("crewProposalError"));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (proposal: Proposal, decision: "approve" | "reject") => {
    setBusy(proposal.id);
    setError(null);
    try {
      await apiRequest(
        "PATCH /api/events/{id}/seasons/{seasonId}/crew-proposals/{proposalId}",
        {
          params: { id: eventId, seasonId, proposalId: proposal.id },
          body: {
            decision,
            rejectionReason: decision === "reject" ? rejectionReasons[proposal.id] ?? "" : undefined,
          },
        },
      );
      await load();
      if (decision === "approve") await onCrewApproved?.();
    } catch (decideError) {
      setError(decideError instanceof ApiError ? decideError.message : t("crewProposalError"));
    } finally {
      setBusy(null);
    }
  };

  const proposer = data.proposerMembershipId
    ? allCandidates.find((candidate) => candidate.membershipId === data.proposerMembershipId)
    : undefined;
  const selectedWithProposer = proposer && !selectedCandidates.some((candidate) => candidateKey(candidate) === candidateKey(proposer))
    ? [proposer, ...selectedCandidates]
    : selectedCandidates;
  const reviewProposals = data.proposals;

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {submitted && <Alert severity="success">{t("proposalSubmitted")}</Alert>}
      {invited && <Alert severity="success">{t("inviteSent", { name: invitedEmail })}</Alert>}

      {data.canPropose && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <BoxHeading title={t("proposeCrew")} description={t("proposeCrewDescription")} />
              <TextField label={t("crewProposalName")} value={name} onChange={(event) => setName(event.target.value)} />
              <Autocomplete<Candidate, true, false, false>
                multiple
                options={allCandidates}
                value={selectedWithProposer}
                onChange={(_, next) => {
                  const nextCandidates = next.filter((candidate) => candidate.membershipId !== data.proposerMembershipId);
                  setSelectedCandidates(proposer ? [proposer, ...nextCandidates] : nextCandidates);
                }}
                getOptionLabel={(candidate) => candidate.name}
                isOptionEqualToValue={(option, value) => candidateKey(option) === candidateKey(value)}
                renderInput={(params) => <TextField {...params} label={t("selectCrewMembers")} helperText={t("proposeCrewDescription")} />}
                renderOption={(props, candidate) => {
                  const { key, ...optionProps } = props as typeof props & { key?: string };
                  return <li key={key} {...optionProps}>{candidate.name}</li>;
                }}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  fullWidth
                  size="small"
                  label={t("inviteByEmailPlaceholder")}
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <Button variant="outlined" onClick={() => void invite()} disabled={busy !== null || !isEmail(inviteEmail)}>
                  {t("inviteByEmailOption", { email: inviteEmail || "email" })}
                </Button>
              </Stack>
              <Button
                variant="contained"
                onClick={() => void submit()}
                disabled={busy !== null || !name.trim() || selectedWithProposer.length < 3 || selectedWithProposer.length > 5}
              >
                {busy === "submit" ? t("submittingCrewProposal") : t("submitCrewProposal")}
              </Button>
              {data.proposals.length > 0 && <ProposalHistory proposals={data.proposals} statusLabel={statusLabel} />}
            </Stack>
          </CardContent>
        </Card>
      )}

      {data.canReview && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">{t("crewProposalReviewQueue")}</Typography>
              {reviewProposals.length === 0 ? <Typography color="text.secondary">{t("noPendingProposals")}</Typography> : reviewProposals.map((proposal) => (
                <Stack key={proposal.id} spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="subtitle1" fontWeight={600}>{proposal.name}</Typography>
                    <Chip size="small" label={statusLabel(proposal.status)} />
                  </Stack>
                  <Typography color="text.secondary">{proposal.memberNames.join(", ")}</Typography>
                  <Typography variant="body2">{t("proposalProposedBy", { name: proposal.proposerName })}</Typography>
                  {proposal.status === "pending" && <>
                    <TextField
                      label={t("rejectionReason")}
                      value={rejectionReasons[proposal.id] ?? ""}
                      onChange={(event) => setRejectionReasons((current) => ({ ...current, [proposal.id]: event.target.value }))}
                      size="small"
                    />
                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" aria-label={t("approveProposalFor", { name: proposal.name })} onClick={() => void decide(proposal, "approve")} disabled={busy !== null}>
                        {t("approveProposal")}
                      </Button>
                      <Button variant="outlined" color="error" aria-label={t("rejectProposalFor", { name: proposal.name })} onClick={() => void decide(proposal, "reject")} disabled={busy !== null}>
                        {t("rejectProposal")}
                      </Button>
                    </Stack>
                  </>}
                  {proposal.rejectionReason && <Typography variant="body2" color="text.secondary">{proposal.rejectionReason}</Typography>}
                  <Divider />
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

function ProposalHistory({ proposals, statusLabel }: { proposals: Proposal[]; statusLabel: (status: string) => string }) {
  const t = useT();
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" fontWeight={600}>{t("yourProposals")}</Typography>
      {proposals.map((proposal) => (
        <Stack key={proposal.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography sx={{ flex: 1 }}>{proposal.name}</Typography>
          <Chip size="small" label={statusLabel(proposal.status)} />
          {proposal.rejectionReason && <Typography variant="body2" color="text.secondary">{proposal.rejectionReason}</Typography>}
        </Stack>
      ))}
    </Stack>
  );
}

function BoxHeading({ title, description }: { title: string; description: string }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary">{description}</Typography>
    </Stack>
  );
}
