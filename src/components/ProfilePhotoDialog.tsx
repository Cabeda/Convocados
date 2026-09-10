import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import CloseIcon from "@mui/icons-material/Close";
import { useT } from "~/lib/useT";
import {
  MAX_PROFILE_PHOTO_BYTES,
  PROFILE_PHOTO_MIME_TYPES,
  isAllowedPhotoMime,
} from "~/lib/profilePhoto";
import { cropImageToDataUrl, readFileAsDataUrl } from "~/lib/cropImage";

interface ProfilePhotoDialogProps {
  open: boolean;
  currentImage: string | null;
  onClose: () => void;
  onSaved: (image: string | null) => void;
}

type Stage = "select" | "crop";

export default function ProfilePhotoDialog({
  open,
  currentImage,
  onClose,
  onSaved,
}: ProfilePhotoDialogProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("select");
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStage("select");
    setSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setArea(null);
    setError(null);
  }, []);

  const acceptFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      if (!isAllowedPhotoMime(file.type)) {
        setError(t("photoInvalidType"));
        return;
      }
      if (file.size > MAX_PROFILE_PHOTO_BYTES) {
        setError(t("photoTooLarge"));
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setSrc(dataUrl);
        setStage("crop");
      } catch {
        setError(t("photoSaveError"));
      }
    },
    [t],
  );

  const handleSave = useCallback(async () => {
    if (!src || !area) return;
    setSaving(true);
    setError(null);
    try {
      const image = await cropImageToDataUrl(src, area, rotation);
      const res = await fetch("/api/me/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error || t("photoSaveError"));
        return;
      }
      onSaved(image);
      onClose();
    } catch {
      setError(t("photoSaveError"));
    } finally {
      setSaving(false);
    }
  }, [area, onClose, onSaved, rotation, src, t]);

  const handleRemove = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/photo", { method: "DELETE" });
      if (!res.ok) {
        setError(t("photoSaveError"));
        return;
      }
      onSaved(null);
      onClose();
    } catch {
      setError(t("photoSaveError"));
    } finally {
      setSaving(false);
    }
  }, [onClose, onSaved, t]);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("profilePhoto")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {stage === "select" && (
            <>
              <Box
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void acceptFile(e.dataTransfer.files?.[0]);
                }}
                sx={{
                  border: "2px dashed",
                  borderColor: "divider",
                  borderRadius: 3,
                  py: 4,
                  px: 2,
                  textAlign: "center",
                  cursor: "pointer",
                  "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                }}
              >
                <AddAPhotoIcon sx={{ fontSize: 40, color: "text.disabled" }} />
                <Typography variant="body2" fontWeight={600} sx={{ mt: 1 }}>
                  {t("choosePhoto")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("photoUploadHint")}
                </Typography>
              </Box>
              <input
                ref={inputRef}
                type="file"
                accept={PROFILE_PHOTO_MIME_TYPES.join(",")}
                hidden
                onChange={(e) => {
                  void acceptFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {currentImage && (
                <Button
                  color="error"
                  onClick={handleRemove}
                  disabled={saving}
                  startIcon={saving ? <CircularProgress size={16} /> : undefined}
                >
                  {t("removePhoto")}
                </Button>
              )}
            </>
          )}

          {stage === "crop" && src && (
            <>
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  height: 280,
                  bgcolor: "grey.900",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <Cropper
                  image={src}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onRotationChange={setRotation}
                  onCropComplete={(_, pixels) => setArea(pixels)}
                />
              </Box>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="caption" sx={{ minWidth: 40 }}>
                  {t("zoom")}
                </Typography>
                <Slider
                  value={zoom}
                  min={1}
                  max={3}
                  step={0.1}
                  onChange={(_, v) => setZoom(v as number)}
                  aria-label={t("zoom")}
                />
              </Stack>
              <Stack direction="row" spacing={1} justifyContent="center">
                <IconButton
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  aria-label={t("rotate")}
                >
                  <RotateRightIcon />
                </IconButton>
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {stage === "crop" && (
          <Button onClick={reset} disabled={saving} startIcon={<CloseIcon />}>
            {t("cancel")}
          </Button>
        )}
        {stage === "crop" && (
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !area}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t("savePhoto")}
          </Button>
        )}
        {stage === "select" && (
          <Button onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
