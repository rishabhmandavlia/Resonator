import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Database,
  Download,
  FileAudio,
  Folder,
  Info,
  LayoutGrid,
  Loader2,
  List,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  Trash2,
  Waves,
  X,
} from "lucide-react";

import {
  apiClient,
  type ProjectSummary,
  type StorageSummaryResponse,
  type StoredAudioFile,
  type VoiceOption,
} from "../services/api";
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
import { Skeleton } from "./ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { StatusToast } from "./ui/status-toast";
import { cn } from "./ui/utils";

const DEFAULT_SORT = "date-desc";
const REMOTE_STORAGE_BATCH_SIZE = 16;
const REMOTE_FORMAT_OPTIONS = ["ALL", "MP3", "OGG", "WAV"];
const DATE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

type SortValue =
  | "name-asc"
  | "name-desc"
  | "size-asc"
  | "size-desc"
  | "date-desc"
  | "date-asc"
  | "duration-asc"
  | "duration-desc";

type ViewMode = "grid" | "list";

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

function WaveformPreview({ seed }: { seed: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || shouldRender) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [shouldRender]);

  const waveformHeights = useMemo(
    () => (shouldRender ? buildWaveformHeights(seed) : []),
    [seed, shouldRender],
  );

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border border-border/60 bg-secondary/20 p-4"
    >
      {shouldRender ? (
        <svg viewBox="0 0 260 82" className="h-16 w-full text-primary/70">
          {waveformHeights.map((height, index) => {
            const x = index * 9 + 8;
            const y = 41 - height / 2;
            return (
              <rect
                key={`${seed}-${index}`}
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
      ) : (
        <div className="h-16 w-full rounded-xl bg-white/60" />
      )}
    </div>
  );
}

export function RemoteStorage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingUndoRef = useRef<PendingUndoState | null>(null);
  const storageViewportRef = useRef<HTMLDivElement | null>(null);
  const requestVersionRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const nextOffsetRef = useRef(0);

  const [files, setFiles] = useState<StoredAudioFile[]>([]);
  const [quotaBytes, setQuotaBytes] = useState(0);
  const [usedBytes, setUsedBytes] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [minDuration, setMinDuration] = useState<string>("");
  const [maxDuration, setMaxDuration] = useState<string>("");
  const [formatFilter, setFormatFilter] = useState("ALL");
  const [sortValue, setSortValue] = useState<SortValue>(DEFAULT_SORT);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [hasLoadedMetadata, setHasLoadedMetadata] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    pendingUndoRef.current = pendingUndo;
  }, [pendingUndo]);

  const loadStorageSummary = useCallback(async () => {
    setIsSummaryLoading(true);

    try {
      const summary: StorageSummaryResponse =
        await apiClient.getStoredAudioSummary();
      setQuotaBytes(summary.quotaBytes);
      setUsedBytes(summary.usedBytes);
      setFileCount(summary.fileCount);
    } catch (summaryError) {
      console.error("Failed to load storage summary:", summaryError);
    } finally {
      setIsSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStorageSummary();
  }, [loadStorageSummary]);

  useEffect(() => {
    if ((!isFiltersOpen && !projectId && !voiceId) || hasLoadedMetadata) {
      return;
    }

    let isDisposed = false;
    setIsMetadataLoading(true);

    void Promise.all([apiClient.listProjects(), apiClient.getAvailableVoices()])
      .then(([loadedProjects, loadedVoices]) => {
        if (isDisposed) {
          return;
        }

        setProjects(loadedProjects);
        setVoices(loadedVoices);
        setHasLoadedMetadata(true);
      })
      .catch(() => {
        if (isDisposed) {
          return;
        }

        setProjects([]);
        setVoices([]);
      })
      .finally(() => {
        if (!isDisposed) {
          setIsMetadataLoading(false);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [hasLoadedMetadata, isFiltersOpen, projectId, voiceId]);

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

  const loadStorageFiles = useCallback(
    async (append = false, requestVersion = requestVersionRef.current) => {
      if (requestInFlightRef.current) {
        return;
      }

      requestInFlightRef.current = true;

      try {
        if (append) {
          setIsLoadingMore(true);
        } else {
          setIsLoading(true);
          setError(null);
        }

        const nextSkip = append ? nextOffsetRef.current : 0;
        const [sortBy, sortOrder] = sortValue.split("-") as [string, string];
        const response = await apiClient.listStoredAudioFiles({
          includeSummary: false,
          projectId,
          voiceId,
          dateFrom,
          dateTo,
          minDuration: minDuration ? Number(minDuration) : null,
          maxDuration: maxDuration ? Number(maxDuration) : null,
          searchText: deferredSearchQuery.trim() || null,
          fileFormat: formatFilter,
          sortBy:
            sortBy === "date"
              ? "created_at"
              : sortBy === "duration"
                ? "duration_seconds"
                : sortBy,
          sortOrder,
          skip: nextSkip,
          limit: REMOTE_STORAGE_BATCH_SIZE,
        });

        if (requestVersion !== requestVersionRef.current) {
          return;
        }

        let nextLoadedCount = 0;
        setFiles((current) => {
          const nextFiles = append
            ? mergeFiles(current, response.files)
            : response.files;
          nextLoadedCount = nextFiles.length;
          return nextFiles;
        });
        nextOffsetRef.current = response.skip + response.files.length;
        setQuotaBytes(response.quotaBytes);
        setFileCount(response.fileCount);
        setTotalCount(response.totalCount);
        setHasMore(nextOffsetRef.current < response.totalCount);
      } catch (err: any) {
        setError(
          err?.detail || err?.message || "Failed to load remote storage files",
        );
        if (!append) {
          setFiles([]);
        }
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
          requestInFlightRef.current = false;
        }
      }
    },
    [
      deferredSearchQuery,
      dateFrom,
      dateTo,
      formatFilter,
      maxDuration,
      minDuration,
      projectId,
      sortValue,
      voiceId,
    ],
  );

  useEffect(() => {
    requestVersionRef.current += 1;
    requestInFlightRef.current = false;
    nextOffsetRef.current = 0;
    setFiles([]);
    setTotalCount(0);
    setHasMore(true);
    setSelectedIds([]);
    setSelectionMode(false);
    storageViewportRef.current?.scrollTo({ top: 0 });

    void loadStorageFiles(false, requestVersionRef.current);
  }, [loadStorageFiles]);

  useEffect(() => {
    return () => {
      stopCurrentAudio();

      if (pendingUndoRef.current) {
        window.clearTimeout(pendingUndoRef.current.timerId);
      }
    };
  }, [stopCurrentAudio]);

  const selectedFileSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedFileSet.has(file.id)),
    [files, selectedFileSet],
  );
  const selectedSizeBytes = useMemo(
    () => selectedFiles.reduce((total, file) => total + file.fileSizeBytes, 0),
    [selectedFiles],
  );
  const remainingBytes = Math.max(quotaBytes - usedBytes, 0);
  const usagePercentage = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;
  const usageTone = getUsageTone(usagePercentage);
  const allVisibleSelected =
    files.length > 0 && files.every((file) => selectedFileSet.has(file.id));
  const hasNoFiles = !isLoading && fileCount === 0;
  const hasNoResults = !isLoading && fileCount > 0 && totalCount === 0;
  const loadedResultCount = Math.min(files.length, totalCount || files.length);
  const resultCountLabel = isLoading
    ? "Loading latest audio..."
    : `Showing ${loadedResultCount} of ${totalCount}`;
  const loadingPlaceholders = useMemo(
    () =>
      Array.from({ length: viewMode === "grid" ? 6 : 8 }, (_, index) => index),
    [viewMode],
  );

  const activeChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];

    if (searchQuery.trim()) {
      chips.push({
        id: "search",
        label: `Search: ${searchQuery.trim()}`,
        onClear: () => setSearchQuery(""),
      });
    }

    if (projectId) {
      chips.push({
        id: "project",
        label: `Project: ${projects.find((project) => project.id === projectId)?.name || "Selected"}`,
        onClear: () => setProjectId(null),
      });
    }

    if (voiceId) {
      chips.push({
        id: "voice",
        label: `Voice: ${voices.find((voice) => voice.id === voiceId)?.name || voiceId}`,
        onClear: () => setVoiceId(null),
      });
    }

    if (dateFrom || dateTo) {
      chips.push({
        id: "date",
        label: "Date range",
        onClear: () => {
          setDateFrom(null);
          setDateTo(null);
        },
      });
    }

    if (minDuration || maxDuration) {
      chips.push({
        id: "duration",
        label: "Duration range",
        onClear: () => {
          setMinDuration("");
          setMaxDuration("");
        },
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
  }, [
    dateFrom,
    dateTo,
    formatFilter,
    maxDuration,
    minDuration,
    projectId,
    projects,
    searchQuery,
    sortValue,
    voiceId,
    voices,
  ]);

  const clearAllFilters = () => {
    setSearchQuery("");
    setProjectId(null);
    setVoiceId(null);
    setDateFrom(null);
    setDateTo(null);
    setMinDuration("");
    setMaxDuration("");
    setFormatFilter("ALL");
    setSortValue(DEFAULT_SORT);
  };

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

  const restoreDeletedFiles = useCallback(() => {
    requestVersionRef.current += 1;
    requestInFlightRef.current = false;
    nextOffsetRef.current = 0;
    setFiles([]);
    setSelectedIds([]);
    setHasMore(true);
    void loadStorageSummary();
    void loadStorageFiles(false, requestVersionRef.current);
  }, [loadStorageFiles, loadStorageSummary]);

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
      restoreDeletedFiles();
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
    restoreDeletedFiles();
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
      nextOffsetRef.current = Math.max(
        0,
        nextOffsetRef.current - targetFiles.length,
      );
      setFileCount((current) => Math.max(0, current - targetFiles.length));
      setTotalCount((current) => {
        const nextCount = Math.max(0, current - targetFiles.length);
        setHasMore(nextOffsetRef.current < nextCount);
        return nextCount;
      });
      setUsedBytes((current) =>
        Math.max(
          0,
          current -
            targetFiles.reduce((total, file) => total + file.fileSizeBytes, 0),
        ),
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
    const visibleIds = files.map((file) => file.id);

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
  const clearToast = useCallback(() => {
    setError(null);
  }, []);

  const handleStorageScroll = useCallback(() => {
    const viewport = storageViewportRef.current;
    if (
      !viewport ||
      !hasMore ||
      isLoading ||
      isLoadingMore ||
      requestInFlightRef.current
    ) {
      return;
    }

    const isNearBottom =
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 160;

    if (isNearBottom) {
      void loadStorageFiles(true, requestVersionRef.current);
    }
  }, [hasMore, isLoading, isLoadingMore, loadStorageFiles]);

  return (
    <div className="relative h-full p-4 md:p-6">
      {error && (
        <StatusToast tone="error" message={error} onClose={clearToast} />
      )}

      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-white shadow-sm">
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Audio Library
              </h1>
              <p className="mt-2 max-w-3xl text-base text-muted-foreground md:text-lg">
                Review generated audio files, switch between rich and compact
                views, and manage your saved clips without leaving the
                workspace.
              </p>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(300px,1fr)]">
            <Card className="order-2 flex min-h-0 flex-col overflow-hidden border-border/50 shadow-sm xl:order-1">
              <CardHeader className="border-b border-border/60 px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold">
                      Saved Audio
                    </CardTitle>
                    <CardDescription>{resultCountLabel}</CardDescription>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center rounded-xl border border-border/60 bg-secondary/20 p-1">
                      <Button
                        variant={viewMode === "grid" ? "secondary" : "ghost"}
                        size="sm"
                        className="gap-2"
                        onClick={() => setViewMode("grid")}
                      >
                        <LayoutGrid className="h-4 w-4" />
                        Grid
                      </Button>
                      <Button
                        variant={viewMode === "list" ? "secondary" : "ghost"}
                        size="sm"
                        className="gap-2"
                        onClick={() => setViewMode("list")}
                      >
                        <List className="h-4 w-4" />
                        List
                      </Button>
                    </div>

                    <Button
                      variant={selectionMode ? "secondary" : "outline"}
                      size="sm"
                      className="gap-2"
                      onClick={handleToggleSelectionMode}
                      disabled={isLoading || fileCount === 0}
                    >
                      <CheckSquare className="h-4 w-4" />
                      {selectionMode ? "Exit Selection" : "Select"}
                    </Button>

                    {selectionMode && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleSelectAllVisible}
                        disabled={files.length === 0}
                      >
                        <CheckSquare className="h-4 w-4" />
                        {allVisibleSelected ? "Deselect All" : "Select Visible"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="h-full p-0">
                {isLoading ? (
                  <div className="h-full overflow-auto">
                    {viewMode === "grid" ? (
                      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {loadingPlaceholders.map((placeholder) => (
                          <div
                            key={placeholder}
                            className="rounded-2xl border border-border/60 bg-white p-4"
                          >
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="mt-3 h-5 w-3/4" />
                            <Skeleton className="mt-2 h-4 w-1/2" />
                            <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              <Skeleton className="h-9 w-full" />
                              <Skeleton className="h-9 w-full" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3 p-4">
                        {loadingPlaceholders.map((placeholder) => (
                          <div
                            key={placeholder}
                            className="rounded-2xl border border-border/60 bg-white p-4"
                          >
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="mt-3 h-5 w-2/3" />
                            <Skeleton className="mt-2 h-4 w-1/3" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : hasNoFiles ? (
                  <div className="p-10">
                    <div className="rounded-3xl border border-dashed border-border/70 bg-secondary/10 px-6 py-14 text-center">
                      <Waves className="mx-auto h-12 w-12 text-muted-foreground/60" />
                      <h3 className="mt-4 text-xl font-semibold text-foreground">
                        Your audio library is empty
                      </h3>
                      <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                        Generate a clip in the studio to start building your
                        library.
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
                        Adjust the current filters or reset them to surface your
                        saved files again.
                      </p>
                      <div className="mt-6 flex flex-wrap justify-center gap-3">
                        <Button variant="outline" onClick={clearAllFilters}>
                          Clear all filters
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setIsFiltersOpen(true)}
                        >
                          Open filters
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    ref={storageViewportRef}
                    className="h-full overflow-auto"
                    onScroll={handleStorageScroll}
                  >
                    {viewMode === "grid" ? (
                      <div
                        className={cn(
                          "grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
                          selectionMode && selectedFiles.length > 0 && "pb-28",
                        )}
                      >
                        {files.map((file) => {
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

                                <WaveformPreview seed={file.id} />

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
                    ) : (
                      <div
                        className={cn(
                          "divide-y divide-border/60 p-2",
                          selectionMode && selectedFiles.length > 0 && "pb-28",
                        )}
                      >
                        {files.map((file) => {
                          const isPreviewLoading = loadingPreviewId === file.id;
                          const isPlaying = playingId === file.id;
                          const isSelected = selectedFileSet.has(file.id);
                          const promptLabel = getPromptLabel(file);
                          const promptPreview = getPromptPreview(file, 110);

                          return (
                            <div
                              key={file.id}
                              className={cn(
                                "group flex flex-col gap-3 rounded-2xl px-3 py-4 transition-colors hover:bg-secondary/10 md:flex-row md:items-center",
                                isSelected &&
                                  "bg-primary/5 ring-1 ring-primary/20",
                              )}
                            >
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                {selectionMode && (
                                  <div className="pt-1">
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

                                <div className="min-w-0 flex-1">
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
                                    <span className="text-xs text-muted-foreground">
                                      {formatDistanceToNow(
                                        new Date(file.uploadedAt),
                                        {
                                          addSuffix: true,
                                        },
                                      )}
                                    </span>
                                  </div>

                                  <p
                                    className="mt-2 truncate text-sm font-semibold text-foreground md:text-base"
                                    title={promptLabel}
                                  >
                                    {promptPreview}
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {formatDuration(file.durationSeconds)} ·{" "}
                                    {formatBytes(file.fileSizeBytes)} ·{" "}
                                    {format(
                                      new Date(file.uploadedAt),
                                      "MMM d, yyyy h:mm a",
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 md:justify-end">
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
                                {!selectionMode && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-red-600"
                                    onClick={() => openDeleteDialog([file])}
                                    aria-label={`Delete ${promptPreview}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isLoadingMore && (
                      <div className="flex items-center justify-center gap-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Loading more files...
                      </div>
                    )}

                    {!hasMore && files.length > 0 && (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        You have reached the end of your saved library.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <aside className="order-1 min-h-0 overflow-auto xl:order-2">
              <div className="flex flex-col gap-4 pr-1">
                <Card className="border-border/50 shadow-sm">
                  <CardContent className="space-y-4 p-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search prompts, projects, or formats"
                        className="pl-10"
                      />
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

                    <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/10 px-4 py-3 text-sm text-muted-foreground">
                      {viewMode === "grid"
                        ? "Grid view shows waveform cards. Switch to list view when you need denser scanning."
                        : "List view is optimized for large libraries and skips waveform rendering for faster scrolling."}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                      onClick={() => setIsFiltersOpen((current) => !current)}
                    >
                      <div>
                        <CardTitle className="text-base font-semibold">
                          Filters
                        </CardTitle>
                        <CardDescription>
                          {activeChips.length > 0
                            ? `${activeChips.length} active`
                            : "Narrow down the library"}
                        </CardDescription>
                      </div>
                      {isFiltersOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </CardHeader>
                  {isFiltersOpen && (
                    <CardContent className="space-y-4 pt-0">
                      <div className="grid gap-3">
                        <Select
                          value={projectId || "ALL"}
                          onValueChange={(value: string) =>
                            setProjectId(value === "ALL" ? null : value)
                          }
                          disabled={isMetadataLoading && !hasLoadedMetadata}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Project" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All projects</SelectItem>
                            {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={voiceId || "ALL"}
                          onValueChange={(value: string) =>
                            setVoiceId(value === "ALL" ? null : value)
                          }
                          disabled={isMetadataLoading && !hasLoadedMetadata}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Voice" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All voices</SelectItem>
                            {voices.map((voice) => (
                              <SelectItem key={voice.id} value={voice.id}>
                                {voice.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            type="date"
                            value={dateFrom || ""}
                            onChange={(event) =>
                              setDateFrom(event.target.value || null)
                            }
                          />
                          <Input
                            type="date"
                            value={dateTo || ""}
                            onChange={(event) =>
                              setDateTo(event.target.value || null)
                            }
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={minDuration}
                            onChange={(event) =>
                              setMinDuration(event.target.value)
                            }
                            placeholder="Min duration (s)"
                          />
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={maxDuration}
                            onChange={(event) =>
                              setMaxDuration(event.target.value)
                            }
                            placeholder="Max duration (s)"
                          />
                        </div>

                        <Select
                          value={sortValue}
                          onValueChange={(value: SortValue) =>
                            setSortValue(value)
                          }
                        >
                          <SelectTrigger className="w-full">
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
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Format" />
                          </SelectTrigger>
                          <SelectContent>
                            {REMOTE_FORMAT_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option === "ALL" ? "All formats" : option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {DATE_PRESETS.map((preset) => (
                          <Button
                            key={preset.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const today = new Date();
                              const end = new Date(today);
                              const start = new Date(today);
                              if (preset.id === "today") {
                                setDateFrom(today.toISOString().slice(0, 10));
                                setDateTo(today.toISOString().slice(0, 10));
                                return;
                              }
                              if (preset.id === "7d") {
                                start.setDate(start.getDate() - 6);
                              }
                              if (preset.id === "30d") {
                                start.setDate(start.getDate() - 29);
                              }
                              setDateFrom(start.toISOString().slice(0, 10));
                              setDateTo(end.toISOString().slice(0, 10));
                            }}
                          >
                            {preset.label}
                          </Button>
                        ))}

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={clearAllFilters}
                          disabled={activeChips.length === 0}
                        >
                          Clear all filters
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>

                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-semibold">
                          Storage
                        </CardTitle>
                        <CardDescription>
                          {isSummaryLoading
                            ? "Refreshing usage and library totals"
                            : `${formatBytes(remainingBytes)} left of ${formatBytes(quotaBytes)}`}
                        </CardDescription>
                      </div>
                      {isSummaryLoading ? (
                        <Skeleton className="h-8 w-24 rounded-full" />
                      ) : (
                        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {formatBytes(remainingBytes)} left
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-0">
                    <div className="rounded-2xl border border-border/60 bg-[linear-gradient(180deg,rgba(236,253,245,0.95),rgba(255,255,255,1))] px-4 py-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        <Database className="h-4 w-4 text-emerald-500" />
                        Used space
                      </div>
                      {isSummaryLoading ? (
                        <div className="mt-3 space-y-2">
                          <Skeleton className="h-7 w-24" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      ) : (
                        <>
                          <div className="mt-3 flex items-baseline justify-between gap-3">
                            <p className="text-2xl font-semibold text-foreground">
                              {formatBytes(usedBytes)}
                            </p>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                usageTone.text,
                              )}
                            >
                              {Math.min(usagePercentage, 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary/50">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                usageTone.bar,
                              )}
                              style={{
                                width: `${Math.min(Math.max(usagePercentage, 0), 100)}%`,
                              }}
                            />
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-border/60 bg-white/90 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                Available space
                              </p>
                              <p className="mt-2 text-lg font-semibold text-foreground">
                                {formatBytes(remainingBytes)}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-white/90 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                Total quota
                              </p>
                              <p className="mt-2 text-lg font-semibold text-foreground">
                                {formatBytes(quotaBytes)}
                              </p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/60 bg-white px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          <FileAudio className="h-4 w-4 text-blue-500" />
                          Library size
                        </div>
                        {isSummaryLoading ? (
                          <Skeleton className="mt-3 h-7 w-16" />
                        ) : (
                          <p className="mt-3 text-2xl font-semibold text-foreground">
                            {fileCount}
                          </p>
                        )}
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-white px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          <Folder className="h-4 w-4 text-orange-500" />
                          {selectionMode ? "Selected size" : "Results loaded"}
                        </div>
                        <p className="mt-3 text-2xl font-semibold text-foreground">
                          {selectionMode
                            ? formatBytes(selectedSizeBytes)
                            : `${loadedResultCount} / ${totalCount}`}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </aside>
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
