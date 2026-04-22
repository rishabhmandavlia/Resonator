import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckSquare,
  Database,
  Download,
  FileAudio,
  Folder,
  Info,
  Loader2,
  Pause,
  Play,
  Search,
  Trash2,
  Waves,
  X,
} from "lucide-react";

import { apiClient, type StoredAudioFile } from "../services/api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "./ui/utils";

const DEFAULT_SORT = "date-desc";

type SortValue =
  | "name-asc"
  | "name-desc"
  | "size-asc"
  | "size-desc"
  | "date-desc"
  | "date-asc"
  | "duration-asc"
  | "duration-desc";

type PendingUndoState = {
  files: StoredAudioFile[];
  totalSizeBytes: number;
  timerId: number;
};

const SORT_LABELS: Record<SortValue, string> = {
  "name-asc": "Prompt A-Z",
  "name-desc": "Prompt Z-A",
  "size-asc": "Size smallest",
  "size-desc": "Size largest",
  "date-desc": "Date newest",
  "date-asc": "Date oldest",
  "duration-asc": "Duration shortest",
  "duration-desc": "Duration longest",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getUsageTone(percentage: number) {
  if (percentage >= 85) {
    return {
      bar: "bg-red-500",
      text: "text-red-600",
      surface: "bg-red-50",
    };
  }

  if (percentage >= 60) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-600",
      surface: "bg-amber-50",
    };
  }

  return {
    bar: "bg-emerald-500",
    text: "text-emerald-600",
    surface: "bg-emerald-50",
  };
}

function buildWaveformHeights(seed: string): number[] {
  const source = seed || "audio";
  return Array.from({ length: 26 }, (_, index) => {
    const charCode = source.charCodeAt(index % source.length);
    return 20 + ((charCode + index * 11) % 52);
  });
}

function mergeFiles(
  currentFiles: StoredAudioFile[],
  nextFiles: StoredAudioFile[],
): StoredAudioFile[] {
  const fileMap = new Map(currentFiles.map((file) => [file.id, file]));
  nextFiles.forEach((file) => {
    fileMap.set(file.id, file);
  });
  return Array.from(fileMap.values());
}

function normalizeTextValue(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function getPromptLabel(file: StoredAudioFile): string {
  const prompt = normalizeTextValue(file.textPrompt);
  if (prompt) {
    return prompt;
  }

  const title = normalizeTextValue(file.title);
  if (title) {
    return title;
  }

  return "Generated audio";
}

function getPromptPreview(file: StoredAudioFile, maxLength = 120): string {
  const prompt = getPromptLabel(file);
  return prompt.length > maxLength
    ? `${prompt.slice(0, maxLength - 1).trimEnd()}...`
    : prompt;
}

function getProjectLabel(file: StoredAudioFile): string {
  const projectName = normalizeTextValue(file.projectName);
  return projectName || "Account library";
}

function getSearchableText(file: StoredAudioFile): string {
  return [getPromptLabel(file), getProjectLabel(file), file.format]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildDownloadName(file: StoredAudioFile): string {
  const extension =
    normalizeTextValue(file.format).replace(/^\./, "") ||
    file.fileName.split(".").pop()?.toLowerCase() ||
    "wav";

  const downloadStem = getPromptLabel(file)
    .slice(0, 72)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${downloadStem || "generated-audio"}.${extension}`;
}

export function RemoteStorage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingUndoRef = useRef<PendingUndoState | null>(null);

  const [files, setFiles] = useState<StoredAudioFile[]>([]);
  const [quotaBytes, setQuotaBytes] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("ALL");
  const [sortValue, setSortValue] = useState<SortValue>(DEFAULT_SORT);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteDialogFiles, setDeleteDialogFiles] = useState<StoredAudioFile[]>(
    [],
  );
  const [isApplyingDelete, setIsApplyingDelete] = useState(false);
  const [detailsFile, setDetailsFile] = useState<StoredAudioFile | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndoState | null>(null);

  useEffect(() => {
    pendingUndoRef.current = pendingUndo;
  }, [pendingUndo]);

  const stopCurrentAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    setPlayingId(null);
  }, []);

  const loadStorageFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.listStoredAudioFiles();
      setFiles(response.files);
      setQuotaBytes(response.quotaBytes);
    } catch (err: any) {
      setError(
        err?.detail || err?.message || "Failed to load remote storage files",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStorageFiles();

    return () => {
      stopCurrentAudio();

      if (pendingUndoRef.current) {
        window.clearTimeout(pendingUndoRef.current.timerId);
      }
    };
  }, [loadStorageFiles, stopCurrentAudio]);

  const formatOptions = useMemo(() => {
    const options = new Set<string>();
    files.forEach((file) => {
      if (file.format) {
        options.add(file.format.toUpperCase());
      }
    });
    return ["ALL", ...Array.from(options).sort()];
  }, [files]);

  const filteredFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const normalizedFormat = formatFilter.toUpperCase();

    const filtered = files.filter((file) => {
      const matchesSearch = !query || getSearchableText(file).includes(query);
      const matchesFormat =
        normalizedFormat === "ALL" ||
        file.format.toUpperCase() === normalizedFormat;

      return matchesSearch && matchesFormat;
    });

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      switch (sortValue) {
        case "name-asc":
          return getPromptLabel(left).localeCompare(
            getPromptLabel(right),
            undefined,
            {
              numeric: true,
              sensitivity: "base",
            },
          );
        case "name-desc":
          return getPromptLabel(right).localeCompare(
            getPromptLabel(left),
            undefined,
            {
              numeric: true,
              sensitivity: "base",
            },
          );
        case "size-asc":
          return left.fileSizeBytes - right.fileSizeBytes;
        case "size-desc":
          return right.fileSizeBytes - left.fileSizeBytes;
        case "date-asc":
          return (
            new Date(left.uploadedAt).getTime() -
            new Date(right.uploadedAt).getTime()
          );
        case "duration-asc":
          return left.durationSeconds - right.durationSeconds;
        case "duration-desc":
          return right.durationSeconds - left.durationSeconds;
        case "date-desc":
        default:
          return (
            new Date(right.uploadedAt).getTime() -
            new Date(left.uploadedAt).getTime()
          );
      }
    });

    return sorted;
  }, [files, formatFilter, searchQuery, sortValue]);

  const selectedFileSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileSet.has(file.id)),
    [files, selectedFileSet],
  );
  const selectedSizeBytes = useMemo(
    () => selectedFiles.reduce((total, file) => total + file.fileSizeBytes, 0),
    [selectedFiles],
  );
  const usedBytes = useMemo(
    () => files.reduce((total, file) => total + file.fileSizeBytes, 0),
    [files],
  );
  const usagePercentage = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;
  const usageTone = getUsageTone(usagePercentage);
  const allVisibleSelected =
    filteredFiles.length > 0 &&
    filteredFiles.every((file) => selectedFileSet.has(file.id));
  const hasNoFiles = !isLoading && files.length === 0;
  const hasNoResults =
    !isLoading && files.length > 0 && filteredFiles.length === 0;

  const activeChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];

    if (searchQuery.trim()) {
      chips.push({
        id: "search",
        label: `Search: ${searchQuery.trim()}`,
        onClear: () => setSearchQuery(""),
      });
    }

    if (formatFilter !== "ALL") {
      chips.push({
        id: "format",
        label: `Format: ${formatFilter}`,
        onClear: () => setFormatFilter("ALL"),
      });
    }

    if (sortValue !== DEFAULT_SORT) {
      chips.push({
        id: "sort",
        label: `Sort: ${SORT_LABELS[sortValue]}`,
        onClear: () => setSortValue(DEFAULT_SORT),
      });
    }

    return chips;
  }, [formatFilter, searchQuery, sortValue]);

  const handleTogglePlayback = async (file: StoredAudioFile) => {
    const source = file.audioUrl || file.audioPath;
    if (!source) {
      setError("This audio file is missing a playable source.");
      return;
    }

    setError(null);

    if (playingId === file.id && audioRef.current) {
      if (audioRef.current.paused) {
        await audioRef.current.play();
        setPlayingId(file.id);
      } else {
        audioRef.current.pause();
        setPlayingId(null);
      }
      return;
    }

    setLoadingPreviewId(file.id);

    try {
      stopCurrentAudio();
      const resolvedUrl = await apiClient.resolveAudioUrl(source);
      const audio = new Audio(resolvedUrl);
      audioRef.current = audio;
      objectUrlRef.current = resolvedUrl.startsWith("blob:")
        ? resolvedUrl
        : null;

      audio.onended = () => {
        setPlayingId(null);
      };

      await audio.play();
      setPlayingId(file.id);
    } catch (err) {
      console.error("Failed to preview audio:", err);
      setError("Failed to preview audio.");
      stopCurrentAudio();
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const handleDownload = async (file: StoredAudioFile) => {
    const source = file.audioUrl || file.audioPath;
    if (!source) {
      setError("This audio file is missing a download source.");
      return;
    }

    try {
      setError(null);
      await apiClient.downloadAudio(source, buildDownloadName(file));
    } catch (err) {
      console.error("Failed to download audio:", err);
      setError("Failed to download audio.");
    }
  };

  const commitDeleteRequest = useCallback(
    async (targetFiles: StoredAudioFile[]) => {
      const ids = targetFiles.map((file) => file.id);
      if (ids.length === 0) {
        return;
      }

      if (ids.length === 1) {
        await apiClient.deleteStoredAudioFile(ids[0]);
        return;
      }

      await apiClient.bulkDeleteStoredAudioFiles(ids);
    },
    [],
  );

  const restoreDeletedFiles = useCallback((targetFiles: StoredAudioFile[]) => {
    setFiles((current) => mergeFiles(current, targetFiles));
  }, []);

  const finalizePendingDelete = useCallback(async () => {
    const currentPending = pendingUndoRef.current;
    if (!currentPending) {
      return;
    }

    window.clearTimeout(currentPending.timerId);
    pendingUndoRef.current = null;
    setPendingUndo(null);

    try {
      await commitDeleteRequest(currentPending.files);
    } catch (err: any) {
      restoreDeletedFiles(currentPending.files);
      setError(
        err?.detail || err?.message || "Failed to delete audio file(s).",
      );
    }
  }, [commitDeleteRequest, restoreDeletedFiles]);

  const undoPendingDelete = () => {
    const currentPending = pendingUndoRef.current;
    if (!currentPending) {
      return;
    }

    window.clearTimeout(currentPending.timerId);
    pendingUndoRef.current = null;
    setPendingUndo(null);
    restoreDeletedFiles(currentPending.files);
  };

  const stageDelete = useCallback(
    async (targetFiles: StoredAudioFile[]) => {
      if (targetFiles.length === 0) {
        return;
      }

      await finalizePendingDelete();

      const targetIds = new Set(targetFiles.map((file) => file.id));
      setFiles((current) => current.filter((file) => !targetIds.has(file.id)));
      setSelectedIds((current) =>
        current.filter((selectedId) => !targetIds.has(selectedId)),
      );
      stopCurrentAudio();

      const timerId = window.setTimeout(() => {
        void finalizePendingDelete();
      }, 5000);

      const nextPending = {
        files: targetFiles,
        totalSizeBytes: targetFiles.reduce(
          (total, file) => total + file.fileSizeBytes,
          0,
        ),
        timerId,
      } satisfies PendingUndoState;

      pendingUndoRef.current = nextPending;
      setPendingUndo(nextPending);
    },
    [finalizePendingDelete, stopCurrentAudio],
  );

  const handleConfirmDelete = async () => {
    setIsApplyingDelete(true);

    try {
      await stageDelete(deleteDialogFiles);
      setDeleteDialogFiles([]);
    } finally {
      setIsApplyingDelete(false);
    }
  };

  const handleOpenDetails = async (file: StoredAudioFile) => {
    setIsDetailsLoading(true);
    setDetailsFile(file);

    try {
      const details = await apiClient.getStoredAudioFile(file.id);
      setDetailsFile(details);
    } catch (err: any) {
      setError(err?.detail || err?.message || "Failed to load audio details.");
    } finally {
      setIsDetailsLoading(false);
    }
  };

  const handleSelectToggle = (fileId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(fileId) ? current : [...current, fileId];
      }

      return current.filter((selectedId) => selectedId !== fileId);
    });
  };

  const handleSelectAllVisible = () => {
    const visibleIds = filteredFiles.map((file) => file.id);

    setSelectedIds((current) => {
      if (allVisibleSelected) {
        return current.filter((selectedId) => !visibleIds.includes(selectedId));
      }

      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const handleToggleSelectionMode = () => {
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedIds([]);
      return;
    }

    setSelectionMode(true);
  };

  const openDeleteDialog = (targetFiles: StoredAudioFile[]) => {
    setDeleteDialogFiles(targetFiles);
  };

  return (
    <div className="relative h-full p-6">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-white shadow-sm">
        <div className="flex min-h-0 flex-1 flex-col gap-6 p-6 md:p-8 lg:p-10">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Remote Storage
              </h1>
              <p className="mt-2 max-w-3xl text-lg text-muted-foreground">
                Review generated audio files, monitor quota usage, and clean up
                saved clips without leaving the workspace.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                variant={selectionMode ? "secondary" : "outline"}
                className="h-11 gap-2 px-6"
                onClick={handleToggleSelectionMode}
                disabled={isLoading || files.length === 0}
              >
                <CheckSquare className="h-5 w-5" />
                {selectionMode ? "Exit Selection" : "Select"}
              </Button>
            </div>
          </div>

          {error && (
            <Alert className="border-red-200 bg-red-50 text-red-950">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Storage action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-6">
              <Card className="border-border/50 shadow-sm bg-secondary/10">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Database className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-semibold">
                        Account Storage
                      </CardTitle>
                      <CardDescription>
                        Provisioned audio capacity for your generated library
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div
                    className={cn(
                      "rounded-2xl border border-transparent p-4",
                      usageTone.surface,
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Used Space
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-foreground">
                          {formatBytes(usedBytes)}
                        </p>
                      </div>
                      <p className={cn("text-sm font-medium", usageTone.text)}>
                        {Math.min(usagePercentage, 100).toFixed(1)}%
                      </p>
                    </div>

                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/70">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          usageTone.bar,
                        )}
                        style={{
                          width: `${Math.min(Math.max(usagePercentage, 0), 100)}%`,
                        }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {formatBytes(quotaBytes)} total quota
                      </span>
                      <span className="font-medium text-foreground">
                        {formatBytes(Math.max(quotaBytes - usedBytes, 0))} left
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-2xl border border-border/60 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileAudio className="h-4 w-4 text-blue-500" />
                        Audio Files
                      </div>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {files.length}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Folder className="h-4 w-4 text-orange-500" />
                        Selected Size
                      </div>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {formatBytes(selectedSizeBytes)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-border/70 bg-white px-4 py-4 text-sm text-muted-foreground">
                    Generated clips appear here automatically after they are
                    created and saved to your account storage.
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex min-h-0 flex-col gap-6">
              <Card className="border-border/50 shadow-sm">
                <CardContent className="space-y-5 p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-center">
                      <div className="relative flex-1">
                        <Input
                          value={searchQuery}
                          onChange={(event) =>
                            setSearchQuery(event.target.value)
                          }
                          placeholder="Search prompts, projects, or formats"
                          className="pl-10"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Select
                          value={sortValue}
                          onValueChange={(value: SortValue) =>
                            setSortValue(value)
                          }
                        >
                          <SelectTrigger className="w-full sm:w-[190px]">
                            <SelectValue placeholder="Sort files" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(SORT_LABELS).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>

                        <Select
                          value={formatFilter}
                          onValueChange={setFormatFilter}
                        >
                          <SelectTrigger className="w-full sm:w-[150px]">
                            <SelectValue placeholder="Format" />
                          </SelectTrigger>
                          <SelectContent>
                            {formatOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option === "ALL" ? "All formats" : option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {selectionMode && (
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={handleSelectAllVisible}
                        disabled={filteredFiles.length === 0}
                      >
                        <CheckSquare className="h-4 w-4" />
                        {allVisibleSelected ? "Deselect All" : "Select All"}
                      </Button>
                    )}
                  </div>

                  {activeChips.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {activeChips.map((chip) => (
                        <Badge
                          key={chip.id}
                          variant="outline"
                          className="gap-2 rounded-full bg-secondary/30 px-3 py-1 text-foreground"
                        >
                          {chip.label}
                          <button
                            type="button"
                            className="rounded-full text-muted-foreground transition hover:text-foreground"
                            onClick={chip.onClear}
                            aria-label={`Clear ${chip.label}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="min-h-0 flex-1 overflow-hidden border-border/50 shadow-sm">
                <CardContent className="h-full p-0">
                  {isLoading ? (
                    <div className="flex h-full min-h-[280px] items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Loading remote storage files...
                    </div>
                  ) : hasNoFiles ? (
                    <div className="p-10">
                      <div className="rounded-3xl border border-dashed border-border/70 bg-secondary/10 px-6 py-14 text-center">
                        <Waves className="mx-auto h-12 w-12 text-muted-foreground/60" />
                        <h3 className="mt-4 text-xl font-semibold text-foreground">
                          Your generated library is empty
                        </h3>
                        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                          Generate a clip in the studio to start building your
                          managed storage library.
                        </p>
                      </div>
                    </div>
                  ) : hasNoResults ? (
                    <div className="p-10">
                      <div className="rounded-3xl border border-dashed border-border/70 bg-secondary/10 px-6 py-14 text-center">
                        <Search className="mx-auto h-12 w-12 text-muted-foreground/60" />
                        <h3 className="mt-4 text-xl font-semibold text-foreground">
                          No files match the current filters
                        </h3>
                        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                          Adjust the search term, reset the format filter, or go
                          back to the default sort to surface your saved files.
                        </p>
                        <div className="mt-6 flex flex-wrap justify-center gap-3">
                          <Button
                            variant="outline"
                            onClick={() => setSearchQuery("")}
                          >
                            Clear Search
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setFormatFilter("ALL")}
                          >
                            Reset Format
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setSortValue(DEFAULT_SORT)}
                          >
                            Reset Sort
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ScrollArea className="h-full">
                      <div
                        className={cn(
                          "grid grid-cols-1 gap-4 p-6 md:grid-cols-2 2xl:grid-cols-3",
                          selectionMode && selectedFiles.length > 0 && "pb-28",
                        )}
                      >
                        {filteredFiles.map((file) => {
                          const waveformHeights = buildWaveformHeights(file.id);
                          const isPreviewLoading = loadingPreviewId === file.id;
                          const isPlaying = playingId === file.id;
                          const isSelected = selectedFileSet.has(file.id);
                          const promptLabel = getPromptLabel(file);
                          const promptPreview = getPromptPreview(file, 96);

                          return (
                            <Card
                              key={file.id}
                              className={cn(
                                "group relative overflow-hidden border-border/60 shadow-sm transition-all hover:border-primary/30 hover:shadow-md",
                                isSelected &&
                                  "border-primary/60 ring-1 ring-primary/20",
                              )}
                            >
                              {selectionMode && (
                                <div className="absolute left-4 top-4 z-10 rounded-md bg-white/90 p-1 shadow-sm backdrop-blur">
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(
                                      checked: boolean | "indeterminate",
                                    ) =>
                                      handleSelectToggle(
                                        file.id,
                                        checked === true,
                                      )
                                    }
                                    aria-label={`Select ${promptPreview}`}
                                  />
                                </div>
                              )}

                              <CardContent className="space-y-4 p-5">
                                <div className="flex items-start justify-between gap-3">
                                  <div
                                    className={cn(
                                      "min-w-0 flex-1",
                                      selectionMode && "pl-9",
                                    )}
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge
                                        variant="outline"
                                        className="bg-secondary/50 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
                                      >
                                        {file.format}
                                      </Badge>
                                      {file.projectName && (
                                        <Badge
                                          variant="outline"
                                          className="text-[11px]"
                                        >
                                          {file.projectName}
                                        </Badge>
                                      )}
                                    </div>

                                    <h3
                                      className="mt-3 text-base font-semibold leading-6 text-foreground"
                                      title={promptLabel}
                                    >
                                      {promptPreview}
                                    </h3>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      {formatBytes(file.fileSizeBytes)} ·{" "}
                                      {formatDuration(file.durationSeconds)} ·{" "}
                                      {formatDistanceToNow(
                                        new Date(file.uploadedAt),
                                        {
                                          addSuffix: true,
                                        },
                                      )}
                                    </p>
                                  </div>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground opacity-100 transition hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                                    onClick={() => openDeleteDialog([file])}
                                    aria-label={`Delete ${promptPreview}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>

                                <div className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
                                  <svg
                                    viewBox="0 0 260 82"
                                    className="h-16 w-full text-primary/70"
                                  >
                                    {waveformHeights.map((height, index) => {
                                      const x = index * 9 + 8;
                                      const y = 41 - height / 2;
                                      return (
                                        <rect
                                          key={`${file.id}-${index}`}
                                          x={x}
                                          y={y}
                                          width="5"
                                          height={height}
                                          rx="2.5"
                                          fill={
                                            index % 3 === 0
                                              ? "rgba(59,130,246,0.55)"
                                              : "rgba(15,23,42,0.18)"
                                          }
                                        />
                                      );
                                    })}
                                  </svg>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() =>
                                      void handleTogglePlayback(file)
                                    }
                                    disabled={isPreviewLoading}
                                  >
                                    {isPreviewLoading ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : isPlaying ? (
                                      <Pause className="h-4 w-4" />
                                    ) : (
                                      <Play className="h-4 w-4" />
                                    )}
                                    {isPlaying ? "Pause" : "Preview"}
                                  </Button>

                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => void handleDownload(file)}
                                  >
                                    <Download className="h-4 w-4" />
                                    Download
                                  </Button>

                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={() => void handleOpenDetails(file)}
                                  >
                                    <Info className="h-4 w-4" />
                                    Details
                                  </Button>

                                  {selectionMode ? (
                                    <Button
                                      variant={
                                        isSelected ? "secondary" : "outline"
                                      }
                                      size="sm"
                                      className="gap-2"
                                      onClick={() =>
                                        handleSelectToggle(file.id, !isSelected)
                                      }
                                    >
                                      <CheckSquare className="h-4 w-4" />
                                      {isSelected ? "Selected" : "Select"}
                                    </Button>
                                  ) : (
                                    <div className="flex items-center justify-center rounded-md border border-border/60 px-3 text-xs text-muted-foreground">
                                      {format(
                                        new Date(file.uploadedAt),
                                        "MMM d, yyyy",
                                      )}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                                  <span className="truncate">
                                    {getProjectLabel(file)}
                                  </span>
                                  <span>
                                    {format(
                                      new Date(file.uploadedAt),
                                      "h:mm a",
                                    )}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {selectionMode && selectedFiles.length > 0 && (
        <div className="pointer-events-none absolute inset-x-6 bottom-6 z-40">
          <div className="mx-auto max-w-4xl pointer-events-auto">
            <div className="rounded-2xl border border-border/60 bg-white/95 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {selectedFiles.length} file
                    {selectedFiles.length === 1 ? "" : "s"} selected
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatBytes(selectedSizeBytes)} queued for bulk actions
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectionMode(false);
                      setSelectedIds([]);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="gap-2"
                    onClick={() => openDeleteDialog(selectedFiles)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Selected
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingUndo && (
        <div className="fixed bottom-6 right-6 z-50 w-[min(calc(100vw-1.5rem),26rem)]">
          <div className="rounded-2xl border border-border/60 bg-white/95 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {pendingUndo.files.length} file
                  {pendingUndo.files.length === 1 ? "" : "s"} removed
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatBytes(pendingUndo.totalSizeBytes)} freed. Undo is
                  available for 5 seconds.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={undoPendingDelete}>
                Undo
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={deleteDialogFiles.length > 0}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setDeleteDialogFiles([]);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Delete{" "}
              {deleteDialogFiles.length === 1
                ? "audio file"
                : "selected audio files"}
            </DialogTitle>
            <DialogDescription>
              Confirm removal before the files are staged for deletion. You can
              undo the action for 5 seconds after confirming.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Alert className="border-red-200 bg-red-50 text-red-950">
              <Trash2 className="h-4 w-4" />
              <AlertTitle>Delete confirmation</AlertTitle>
              <AlertDescription>
                {deleteDialogFiles.length === 1
                  ? "This audio file will be removed from remote storage and its database record will be deleted."
                  : "These audio files will be removed from remote storage and their database records will be deleted."}
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-[min(45vh,20rem)] shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-secondary/10">
              <div className="space-y-2 p-4">
                {deleteDialogFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-white px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {getPromptPreview(file, 88)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(file.fileSizeBytes)} · {file.format} ·{" "}
                        {formatDuration(file.durationSeconds)}
                      </p>
                    </div>
                    <Badge variant="outline">{getProjectLabel(file)}</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="shrink-0 border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogFiles([])}
              disabled={isApplyingDelete}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              onClick={() => void handleConfirmDelete()}
              disabled={isApplyingDelete}
            >
              {isApplyingDelete ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailsFile !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setDetailsFile(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audio Details</DialogTitle>
            <DialogDescription>
              Relevant metadata from the saved record for this generated audio
              clip.
            </DialogDescription>
          </DialogHeader>

          {detailsFile && (
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-4">
                {isDetailsLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Refreshing latest details...
                  </div>
                )}

                <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Prompt
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {getPromptLabel(detailsFile)}
                  </p>
                </div>

                {normalizeTextValue(detailsFile.title) &&
                  normalizeTextValue(detailsFile.title) !==
                    getPromptLabel(detailsFile) && (
                    <div className="rounded-2xl border border-border/60 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Saved Title
                      </p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {normalizeTextValue(detailsFile.title)}
                      </p>
                    </div>
                  )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Format
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {detailsFile.format}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      File Size
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {formatBytes(detailsFile.fileSizeBytes)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Duration
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {formatDuration(detailsFile.durationSeconds)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Saved To Library
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {format(
                        new Date(detailsFile.uploadedAt),
                        "MMM d, yyyy • h:mm a",
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Project
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {getProjectLabel(detailsFile)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Generated On
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {format(
                        new Date(detailsFile.createdAt),
                        "MMM d, yyyy • h:mm a",
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
