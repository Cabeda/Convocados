import { useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, Stack, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";

interface SeasonSummary {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  memberCount: number;
}

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

export default function SeasonListPage({ eventId }: { eventId: string }) {
  const t = useT();
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSeasons = () => {
    const controller = new AbortController();
    fetch(`/api/events/${eventId}/seasons`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? t("somethingWentWrong"));
        if (data.locked) {
          setLocked(true);
          return;
        }
        setSeasons(Array.isArray(data.seasons) ? data.seasons : []);
        setCanManage(!!data.canManage);
      })
      .catch((fetchError: unknown) => {
        if (!controller.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : t("somethingWentWrong"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadSeasons();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, [eventId]);

  const createSeason = async () => {
    setCreating(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/seasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          registrationOpensAt: opensAt ? new Date(opensAt).toISOString() : "",
          registrationClosesAt: closesAt ? new Date(closesAt).toISOString() : "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setFormError(data.error ?? t("somethingWentWrong")); return; }
      setShowForm(false);
      setName(""); setOpensAt(""); setClosesAt("");
      setLoading(true);
      loadSeasons();
    } catch {
      setFormError(t("somethingWentWrong"));
    } finally {
      setCreating(false);
    }
  };

  const canSubmit = name.trim().length > 0 && !!opensAt && !!closesAt && closesAt > opensAt;

  const currentSeasons = useMemo(() => seasons.filter((season) => !TERMINAL_STATUSES.has(season.status)), [seasons]);
  const pastSeasons = useMemo(() => seasons.filter((season) => TERMINAL_STATUSES.has(season.status)), [seasons]);
  const statusLabel = (status: string) => ({
    registration: t("seasonStatusRegistration"),
    active: t("seasonStatusActive"),
    review: t("seasonStatusReview"),
    completed: t("seasonStatusCompleted"),
    cancelled: t("seasonStatusCancelled"),
  }[status] ?? status);

  const renderSeason = (season: SeasonSummary) => (
    <Card
      key={season.id}
      component="a"
      href={`/events/${eventId}/seasons/${season.id}`}
      variant="outlined"
      sx={{ textDecoration: "none", color: "inherit", "&:hover": { borderColor: "primary.main" } }}
    >
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6" component="h3">{season.name}</Typography>
          <Stack spacing={0.5} sx={{ alignItems: "flex-end" }}>
            <Chip size="small" label={statusLabel(season.status)} />
            <Typography variant="body2" color="text.secondary">
              {[season.startsAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(season.startsAt)) : null,
                t("seasonMemberCount", { n: season.memberCount })].filter(Boolean).join(" · ")}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex" }}>
              <Button variant="outlined" size="small" startIcon={<ArrowBackIcon />} href={`/events/${eventId}`}>
                {t("backToGame")}
              </Button>
            </Box>
            <BoxHeader title={t("seasons")} description={t("seasonHistoryDescription")} />
            {!loading && !error && !locked && canManage && (
              <>
                {!showForm && (
                  <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setShowForm(true); setFormError(null); }} sx={{ alignSelf: "flex-start" }}>
                    {t("startNewSeason")}
                  </Button>
                )}
                {showForm && (
                  <Card variant="outlined">
                    <CardContent>
                      <Stack spacing={2}>
                        <Typography variant="h6">{t("startNewSeason")}</Typography>
                        <Typography variant="body2" color="text.secondary">{t("seasonPeriodHint")}</Typography>
                        {formError && <Alert severity="error" onClose={() => setFormError(null)}>{formError}</Alert>}
                        <TextField
                          label={t("seasonNameLabel")} value={name}
                          onChange={(event) => setName(event.target.value)}
                          fullWidth size="small" slotProps={{ htmlInput: { maxLength: 100 } }}
                        />
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                          <Button onClick={() => { setShowForm(false); setFormError(null); }} disabled={creating}>{t("cancel")}</Button>
                          <Button variant="contained" onClick={() => void createSeason()} disabled={creating || !canSubmit}>
                            {creating ? t("creating") : t("createSeason")}
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
            {loading && <Container sx={{ textAlign: "center" }}><CircularProgress /></Container>}
            {error && <Alert severity="error">{error}</Alert>}
            {!loading && !error && locked && <Alert severity="info">{t("eventLocked")}</Alert>}
            {!loading && !error && !locked && seasons.length === 0 && <Alert severity="info">{t("noSeasons")}</Alert>}
            {!loading && !error && !locked && currentSeasons.length > 0 && (
              <Stack spacing={1.5}>
                <Typography variant="h5" component="h2">{t("currentSeasons")}</Typography>
                {currentSeasons.map(renderSeason)}
              </Stack>
            )}
            {!loading && !error && !locked && pastSeasons.length > 0 && (
              <Stack spacing={1.5}>
                <Typography variant="h5" component="h2">{t("pastSeasons")}</Typography>
                {pastSeasons.map(renderSeason)}
              </Stack>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}

function BoxHeader({ title, description }: { title: string; description: string }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="h4" component="h1" fontWeight={700}>{title}</Typography>
      <Typography color="text.secondary">{description}</Typography>
    </Stack>
  );
}
