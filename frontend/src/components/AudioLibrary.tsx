import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Download,
  FileText,
  Loader,
  Pause,
  Play,
  Search,
  Trash2,
  Wand2,
  Waves,
} from "lucide-react";

import { apiClient, type VoiceOption } from "../services/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

export interface AudioLibraryItem {
  id: string;
  project_id: string | null;
  project_name?: string | null;
  text: string;
  text_prompt: string;
  voice_id: string | null;
  speed?: number;
  pitch?: number;
  sample_rate?: number;
  audio_url: string | null;
  audio_file_path: string | null;
  duration_seconds: number;
  created_at: string;
  file_format: string;
}

interface AudioLibraryProps {
  items: AudioLibraryItem[];
  voices?: VoiceOption[];
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  isLoading?: boolean;
  showProjectName?: boolean;
  searchPlaceholder?: string;
  onDelete?: (item: AudioLibraryItem) => Promise<void>;
  onUseText?: (item: AudioLibraryItem) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onReachEnd?: () => void;
}

export function AudioLibrary({
  items,
  voices = [],
  title,
  description,
  emptyTitle,
  emptyDescription,
  isLoading = false,
  showProjectName = false,
  searchPlaceholder,
  onDelete,
  onUseText,
  hasMore = false,
  isLoadingMore = false,
  onReachEnd,
}: AudioLibraryProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] =
    useState<AudioLibraryItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<AudioLibraryItem | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const listViewportRef = useRef<HTMLDivElement | null>(null);

  const voiceMap = useMemo(
    () => new Map(voices.map((voice) => [voice.id, voice.name])),
    [voices],
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) => {
      const previewText = item.text_prompt || item.text;
      const voiceLabel = item.voice_id
        ? voiceMap.get(item.voice_id) || item.voice_id
        : "";

      return [previewText, voiceLabel, item.project_name || ""]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [items, searchQuery, voiceMap]);

  const stopCurrentAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    setPlayingId(null);
  };

  const getVoiceLabel = (item: AudioLibraryItem) => {
    if (!item.voice_id) {
      return "Unknown Voice";
    }

    return voiceMap.get(item.voice_id) || item.voice_id;
  };

  const handleTogglePlayback = async (item: AudioLibraryItem) => {
    const source = item.audio_url || item.audio_file_path;
    if (!source) {
      setActionError("This generation does not have an audio file.");
      return;
    }

    setActionError(null);

    if (playingId === item.id && audioRef.current) {
      if (audioRef.current.paused) {
        await audioRef.current.play();
        setPlayingId(item.id);
      } else {
        audioRef.current.pause();
        setPlayingId(null);
      }
      return;
    }

    setLoadingAudioId(item.id);

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
      setPlayingId(item.id);
    } catch (error) {
      console.error("Failed to play audio:", error);
      setActionError("Failed to play audio.");
      stopCurrentAudio();
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleDownload = async (item: AudioLibraryItem) => {
    const source = item.audio_url || item.audio_file_path;
    if (!source) {
      setActionError("This generation does not have an audio file.");
      return;
    }

    setActionError(null);

    try {
      await apiClient.downloadAudio(
        source,
        `${item.voice_id || "generation"}_${item.id}.${item.file_format || "wav"}`,
      );
    } catch (error) {
      console.error("Failed to download audio:", error);
      setActionError("Failed to download audio.");
    }
  };

  const requestDelete = (item: AudioLibraryItem) => {
    if (!onDelete) {
      return;
    }

    setDeleteError(null);
    setPendingDeleteItem(item);
  };

  const handleDelete = async () => {
    if (!onDelete || !pendingDeleteItem) {
      return;
    }

    setDeletingId(pendingDeleteItem.id);
    setDeleteError(null);
    setActionError(null);

    try {
      await onDelete(pendingDeleteItem);

      if (playingId === pendingDeleteItem.id) {
        stopCurrentAudio();
      }

      setPendingDeleteItem(null);
    } catch (error) {
      console.error("Failed to delete generation:", error);
      setDeleteError("Failed to delete generation.");
      setActionError("Failed to delete generation.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleListScroll = useCallback(() => {
    const viewport = listViewportRef.current;
    if (!viewport || !onReachEnd || !hasMore || isLoading || isLoadingMore) {
      return;
    }

    const isNearBottom =
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 120;

    if (isNearBottom) {
      onReachEnd();
    }
  }, [hasMore, isLoading, isLoadingMore, onReachEnd]);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{title}</CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
          <Badge variant="secondary" className="bg-secondary/60">
            {filteredItems.length} saved
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}

        {searchPlaceholder && items.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="pl-10"
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader className="mr-2 h-4 w-4 animate-spin" />
            Loading audio library...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
            <Waves className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <h3 className="text-sm font-semibold text-foreground">
              {items.length === 0 ? emptyTitle : "No matching audio found"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {items.length === 0
                ? emptyDescription
                : "Try a different search term to find the saved generation you need."}
            </p>
          </div>
        ) : (
          <div
            ref={listViewportRef}
            className="h-[360px] overflow-auto pr-3"
            onScroll={handleListScroll}
          >
            <div className="space-y-3 pb-3">
              {filteredItems.map((item) => {
                const previewText = item.text_prompt || item.text;
                const isPlaying = playingId === item.id;
                const isBusy = loadingAudioId === item.id;
                const durationLabel = Number.isFinite(item.duration_seconds)
                  ? `${item.duration_seconds.toFixed(2)}s`
                  : "Pending";

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="bg-secondary/70"
                          >
                            {getVoiceLabel(item)}
                          </Badge>
                          <Badge variant="outline">{durationLabel}</Badge>
                          {showProjectName && item.project_name && (
                            <Badge variant="outline">{item.project_name}</Badge>
                          )}
                        </div>

                        <div>
                          <p className="text-sm font-medium leading-6 text-foreground line-clamp-2">
                            {previewText}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(item.created_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => handleTogglePlayback(item)}
                          disabled={isBusy}
                        >
                          {isBusy ? (
                            <Loader className="h-4 w-4 animate-spin" />
                          ) : isPlaying ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          {isPlaying ? "Pause" : "Play"}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => handleDownload(item)}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => setSelectedItem(item)}
                        >
                          <FileText className="h-4 w-4" />
                          Show Text
                        </Button>

                        {onUseText && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => onUseText(item)}
                          >
                            <Wand2 className="h-4 w-4" />
                            Load Script
                          </Button>
                        )}

                        {onDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => requestDelete(item)}
                            disabled={deletingId === item.id}
                          >
                            {deletingId === item.id ? (
                              <Loader className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoadingMore && (
                <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Loading more audio...
                </div>
              )}

              {!hasMore && filteredItems.length > 0 && onReachEnd && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  You have reached the end of this list.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={selectedItem !== null}
        onOpenChange={(open: boolean) => !open && setSelectedItem(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generation Script</DialogTitle>
            <DialogDescription>
              {selectedItem ? getVoiceLabel(selectedItem) : "Saved generation"}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-auto rounded-xl bg-secondary/30 p-4 text-sm leading-7 text-foreground whitespace-pre-wrap">
            {selectedItem?.text_prompt || selectedItem?.text}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeleteItem !== null}
        onOpenChange={(open: boolean) => {
          if (!open && deletingId === null) {
            setPendingDeleteItem(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete generation</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteItem
                ? `Delete this saved generation from your history? ${pendingDeleteItem.text_prompt || pendingDeleteItem.text}`
                : "Delete this saved generation from your history?"}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deletingId !== null}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deletingId !== null ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
