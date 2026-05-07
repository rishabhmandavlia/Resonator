/**
 * Kokoro Studio Component
 * Text-to-speech generation interface with persistent state management
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Slider } from "./ui/slider";
import { Sparkles, Wand2, RefreshCw, AlertCircle, Loader } from "lucide-react";
import { useAuth } from "../services/auth";
import {
  apiClient,
  type GenerationJobResponse,
  type GenerationResponse,
  type ProjectSummary,
  type StoredGeneration,
  type VoiceOption,
} from "../services/api";
import { usePersistentState } from "../hooks/usePersistentState";
import { AudioLibrary, type AudioLibraryItem } from "./AudioLibrary";
import { AudioWaveformPlayer } from "./AudioWaveformPlayer";
import { GenerationHelpBook } from "./GenerationHelpBook";
import { StatusToast } from "./ui/status-toast";
import { Progress } from "./ui/progress";

// Storage key prefix for this component
const STORAGE_PREFIX = "kokoro_studio_";
const STANDALONE_PROJECT_ID = "standalone";

export function KokoroStudio({
  preSelectedProjectId,
  forceStandalone,
  lockProjectSelection,
  showWritingGuideTrigger = true,
  onProjectActivity,
}: {
  preSelectedProjectId?: string;
  forceStandalone?: boolean;
  lockProjectSelection?: boolean;
  showWritingGuideTrigger?: boolean;
  onProjectActivity?: (updatedAt: string) => void;
} = {}) {
  const { user, isLoading: authLoading } = useAuth();

  // Persistent state management
  const [text, setText] = usePersistentState<string>(
    `${STORAGE_PREFIX}text`,
    "",
  );
  const [voice, setVoice] = usePersistentState<string>(
    `${STORAGE_PREFIX}voice`,
    "af_bella",
  );
  const [speed, setSpeed] = usePersistentState<number>(
    `${STORAGE_PREFIX}speed`,
    1.0,
  );
  const [pitch, setPitch] = usePersistentState<number>(
    `${STORAGE_PREFIX}pitch`,
    1.0,
  );
  const [sampleRate, setSampleRate] = usePersistentState<number>(
    `${STORAGE_PREFIX}sampleRate`,
    22050,
  );
  const [audioFormat, setAudioFormat] = usePersistentState<string>(
    `${STORAGE_PREFIX}audioFormat`,
    "wav",
  );
  const [selectedProject, setSelectedProject] = usePersistentState<string>(
    `${STORAGE_PREFIX}project`,
    preSelectedProjectId || STANDALONE_PROJECT_ID,
  );

  // Non-persistent state
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState<string | null>(null);
  const [generationJobId, setGenerationJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentGeneration, setCurrentGeneration] =
    useState<GenerationResponse | null>(null);
  const [savedGenerations, setSavedGenerations] = useState<StoredGeneration[]>(
    [],
  );
  const [isLoadingGenerations, setIsLoadingGenerations] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const clearToast = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  // Load projects and voices after auth is ready
  useEffect(() => {
    if (!authLoading && user) {
      loadProjects();
      loadVoices();
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (!authLoading && !user) {
      setProjects([]);
      setSavedGenerations([]);
      setCurrentGeneration(null);
      setAudioUrl(null);
      setIsLoadingProjects(false);
    }
  }, [authLoading, user]);

  // Update selectedProject when preSelectedProjectId changes
  useEffect(() => {
    if (forceStandalone) {
      setSelectedProject(STANDALONE_PROJECT_ID);
      return;
    }

    if (preSelectedProjectId) {
      setSelectedProject(preSelectedProjectId);
    }
  }, [forceStandalone, preSelectedProjectId, setSelectedProject]);

  useEffect(() => {
    if (selectedProject === STANDALONE_PROJECT_ID) {
      setSavedGenerations([]);
    }
  }, [selectedProject]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  // Load saved project audio when project changes
  useEffect(() => {
    if (
      !authLoading &&
      user &&
      !isLoadingProjects &&
      selectedProject &&
      selectedProject !== STANDALONE_PROJECT_ID &&
      projects.some((project) => project.id === selectedProject)
    ) {
      loadGenerations();
    }
  }, [authLoading, user, isLoadingProjects, projects, selectedProject]);

  // If the persisted project no longer belongs to the user, fall back to standalone mode.
  useEffect(() => {
    if (
      !authLoading &&
      user &&
      !isLoadingProjects &&
      selectedProject &&
      selectedProject !== STANDALONE_PROJECT_ID &&
      projects.length > 0 &&
      !projects.some((project) => project.id === selectedProject)
    ) {
      setSelectedProject(STANDALONE_PROJECT_ID);
      setSavedGenerations([]);
    }
  }, [
    authLoading,
    user,
    isLoadingProjects,
    projects,
    selectedProject,
    setSelectedProject,
  ]);

  const loadProjects = async () => {
    try {
      setIsLoadingProjects(true);
      setError(null);
      console.log("[KokoroStudio] Loading projects...");
      const loaded = await apiClient.listProjects();
      console.log("[KokoroStudio] Projects loaded:", loaded);
      setProjects(loaded);
    } catch (err: any) {
      console.error("[KokoroStudio] Error loading projects:", err);
      setError(
        "Failed to load projects: " +
          (err?.detail || err?.message || "Unknown error"),
      );
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const loadVoices = async () => {
    try {
      setIsLoadingVoices(true);
      console.log("[KokoroStudio] Loading voices...");
      const loaded = await apiClient.getAvailableVoices();
      console.log("[KokoroStudio] Voices loaded:", loaded.length);
      setVoices(loaded);

      if (loaded.length > 0 && !loaded.some((item) => item.id === voice)) {
        setVoice(loaded[0].id);
      }
    } catch (err: any) {
      console.error("[KokoroStudio] Error loading voices:", err);
      setError(
        "Failed to load voice options: " +
          (err?.detail || err?.message || "Unknown error"),
      );
    } finally {
      setIsLoadingVoices(false);
    }
  };

  const loadGenerations = async () => {
    try {
      if (
        !selectedProject ||
        selectedProject === STANDALONE_PROJECT_ID ||
        !projects.some((project) => project.id === selectedProject)
      ) {
        return;
      }

      setIsLoadingGenerations(true);
      const loaded = await apiClient.listGenerations(selectedProject);
      setSavedGenerations(loaded);
    } catch (err: any) {
      if (err?.status === 403) {
        setSelectedProject(STANDALONE_PROJECT_ID);
        setSavedGenerations([]);
        return;
      }

      console.error("Failed to load generations:", err);
    } finally {
      setIsLoadingGenerations(false);
    }
  };

  const handleGenerate = async () => {
    // Validation
    if (!text.trim()) {
      setError("Please enter text to generate");
      return;
    }

    if (text.length > 5000) {
      setError("Text is too long (max 5000 characters)");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStage("Starting generation");
    setError(null);
    setSuccess(null);

    try {
      const title = `${voice} - ${text.substring(0, 50)}`;
      const projectToUse =
        selectedProject && selectedProject !== STANDALONE_PROJECT_ID
          ? selectedProject
          : STANDALONE_PROJECT_ID;

      const job = await apiClient.startGenerationJob(
        projectToUse,
        text,
        voice,
        speed,
        pitch,
        sampleRate,
        audioFormat,
        undefined,
        title,
      );

      setGenerationJobId(job.job_id);

      const pollJob = async (): Promise<void> => {
        const current = await apiClient.getGenerationJob(job.job_id);
        setGenerationProgress(current.progress);
        setGenerationStage(current.stage);

        if (current.status === "completed" && current.result) {
          const generation = current.result;
          setCurrentGeneration(generation);
          const playableUrl = await apiClient.resolveAudioUrl(
            generation.audio_url || generation.audio_file_path || "",
          );
          setAudioUrl(playableUrl);
          setSuccess(
            projectToUse === STANDALONE_PROJECT_ID
              ? "Audio generated successfully and saved to generation history!"
              : "Audio generated successfully!",
          );
          if (projectToUse !== STANDALONE_PROJECT_ID) {
            await loadGenerations();
            onProjectActivity?.(
              generation.created_at || new Date().toISOString(),
            );
          }
          setIsGenerating(false);
          setGenerationJobId(null);
          setGenerationStage("Complete");
          setGenerationProgress(100);
          return;
        }

        if (current.status === "cancelled") {
          setError("Generation cancelled");
          setAudioUrl(null);
          setCurrentGeneration(null);
          setIsGenerating(false);
          setGenerationJobId(null);
          setGenerationStage(null);
          setGenerationProgress(0);
          return;
        }

        if (current.status === "failed") {
          setError(current.error || "Failed to generate audio");
          setIsGenerating(false);
          setGenerationJobId(null);
          setGenerationStage(null);
          setGenerationProgress(0);
          return;
        }

        pollTimerRef.current = window.setTimeout(() => {
          void pollJob();
        }, 1000);
      };

      await pollJob();
    } catch (err: any) {
      setError(err?.detail || "Failed to generate audio");
      console.error(err);
    }
  };

  const handleCancelGeneration = async () => {
    if (!generationJobId) return;
    try {
      await apiClient.cancelGenerationJob(generationJobId);
      setSuccess("Generation cancelled");
    } catch (err: any) {
      setError(err?.detail || "Failed to cancel generation");
    } finally {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setIsGenerating(false);
      setGenerationJobId(null);
      setGenerationStage(null);
      setGenerationProgress(0);
    }
  };

  const handleDeleteGeneration = async (generation: AudioLibraryItem) => {
    if (!selectedProject || selectedProject === STANDALONE_PROJECT_ID) {
      return;
    }

    await apiClient.deleteGeneration(selectedProject, generation.id);
    setSavedGenerations((current) =>
      current.filter((item) => item.id !== generation.id),
    );

    if (currentGeneration?.id === generation.id) {
      setAudioUrl(null);
      setCurrentGeneration(null);
    }

    onProjectActivity?.(new Date().toISOString());
    setSuccess("Generation deleted successfully!");
  };

  const handleUseSavedGeneration = (generation: AudioLibraryItem) => {
    setText(generation.text_prompt || generation.text);
    if (generation.voice_id) {
      setVoice(generation.voice_id);
    }

    if (typeof generation.speed === "number") {
      setSpeed(generation.speed);
    }

    if (typeof generation.pitch === "number") {
      setPitch(generation.pitch);
    }

    if (typeof generation.sample_rate === "number") {
      setSampleRate(generation.sample_rate);
    }

    const normalizedFormat = generation.file_format?.toLowerCase();
    if (
      normalizedFormat === "wav" ||
      normalizedFormat === "mp3" ||
      normalizedFormat === "ogg"
    ) {
      setAudioFormat(normalizedFormat);
    }

    setSuccess("Loaded generation script and audio settings into the editor.");
  };

  const handleDownload = async () => {
    if (!audioUrl) {
      setError("No audio to download");
      return;
    }

    try {
      const fileFormat = (
        currentGeneration?.file_format ||
        audioFormat ||
        "wav"
      ).toLowerCase();
      const baseName = (currentGeneration?.title || `${voice}_${Date.now()}`)
        .trim()
        .replace(/[<>:"/\\|?*]+/g, " ")
        .replace(/\s+/g, "_")
        .replace(/\.[A-Za-z0-9]+$/, "")
        .replace(/^_+|_+$/g, "");
      const filename = `${baseName || "audio"}.${fileFormat}`;

      await apiClient.downloadAudio(audioUrl, filename);
      setSuccess("Audio downloaded successfully!");
    } catch (err) {
      setError("Failed to download audio");
      console.error(err);
    }
  };

  const handleClearState = () => {
    setText("");
    setVoice("af_bella");
    setSpeed(1.0);
    setPitch(1.0);
    setSampleRate(22050);
    setAudioFormat("wav");

    if (forceStandalone) {
      setSelectedProject(STANDALONE_PROJECT_ID);
    } else if (lockProjectSelection && preSelectedProjectId) {
      setSelectedProject(preSelectedProjectId);
    } else {
      setSelectedProject(STANDALONE_PROJECT_ID);
    }

    setAudioUrl(null);
    setCurrentGeneration(null);
    setSuccess("State cleared");
  };

  const voiceDisplayName = voices.find((v) => v.id === voice)?.name || voice;
  const activeProjectName =
    projects.find((project) => project.id === selectedProject)?.name ||
    "Active Project";
  const isProjectMode =
    !!selectedProject && selectedProject !== STANDALONE_PROJECT_ID;
  const showProjectSelector = !forceStandalone && !lockProjectSelection;
  const toastNotice =
    error !== null
      ? { tone: "error" as const, message: error }
      : success !== null
        ? { tone: "success" as const, message: success }
        : null;

  return (
    <div className="w-full h-full flex flex-col bg-gradient-to-br from-background to-secondary/20 overflow-hidden">
      {toastNotice && (
        <StatusToast
          tone={toastNotice.tone}
          message={toastNotice.message}
          onClose={clearToast}
        />
      )}

      {/* Header */}
      <div className="border-b border-border/50 px-4 sm:px-6 py-3 flex-shrink-0 bg-card/50 backdrop-blur">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                Resonator
              </h1>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:text-xs">
                AI Text-to-Speech Generation
              </p>
            </div>
          </div>

          {showWritingGuideTrigger && (
            <GenerationHelpBook
              triggerLabel="Writing guide"
              triggerClassName="bg-white/80"
            />
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 sm:p-6 space-y-6 min-h-full">
          {isLoadingProjects ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-center space-y-2">
                <Loader className="w-8 h-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          ) : (
            <>
              {/* Error Message - Always show if there's an error */}
              {error && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center space-y-4 max-w-md">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
                    <div>
                      <h3 className="font-semibold text-red-900 mb-2">
                        Error Loading
                      </h3>
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                    <Button
                      onClick={() => {
                        setError(null);
                        loadProjects();
                        loadVoices();
                      }}
                      className="bg-primary hover:bg-primary/90"
                    >
                      Try Again
                    </Button>
                  </div>
                </div>
              )}

              {showProjectSelector ? (
                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Save Location</CardTitle>
                    <CardDescription className="text-xs">
                      Pick a project to store generated audio, or stay in quick
                      generation mode.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Select
                      value={selectedProject}
                      onValueChange={setSelectedProject}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a project..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={STANDALONE_PROJECT_ID}>
                          Quick Generate
                        </SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isProjectMode && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Audio generated here stays outside project workspaces,
                        but it is still saved to your generation history.
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : lockProjectSelection && isProjectMode ? (
                <Card className="border-border/50 bg-secondary/20 shadow-sm">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Project Workspace
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        Saving directly into {activeProjectName}
                      </p>
                    </div>
                    <Badge variant="secondary" className="bg-secondary/70">
                      Auto-save enabled
                    </Badge>
                  </CardContent>
                </Card>
              ) : null}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Input & Output */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Text Input */}
                  <Card className="border-border/50 shadow-sm flex flex-col overflow-hidden">
                    <CardHeader className="bg-secondary/30 pb-2 flex-shrink-0">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Wand2 className="w-4 h-4 text-primary flex-shrink-0" />
                          Script
                        </CardTitle>
                        <div className="flex gap-1 items-center">
                          <span className="text-xs text-muted-foreground">
                            {text.length}/5000
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setText("")}
                            title="Clear text"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
                      <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Enter text to synthesize... (max 5000 characters)"
                        className="border-0 focus-visible:ring-0 rounded-none resize-none p-3 text-sm flex-1"
                        maxLength={5000}
                      />
                      <div className="p-3 bg-secondary/20 flex items-center justify-between border-t border-border/50 gap-2">
                        <Button
                          className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 w-full text-xs gap-1"
                          onClick={handleGenerate}
                          disabled={
                            isGenerating || !text.trim() || isLoadingVoices
                          }
                        >
                          {isGenerating ? (
                            <>
                              <Loader className="w-3 h-3 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3" />
                              Generate
                            </>
                          )}
                        </Button>
                        {isGenerating && generationJobId && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={handleCancelGeneration}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                      {isGenerating && (
                        <div className="space-y-2 border-t border-border/50 bg-background/80 p-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{generationStage || "Generating audio"}</span>
                            <span>{generationProgress}%</span>
                          </div>
                          <Progress value={generationProgress} />
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Audio Playback — Waveform Player */}
                  {audioUrl && (
                    <AudioWaveformPlayer
                      audioUrl={audioUrl}
                      voiceName={voiceDisplayName}
                      fileFormat={currentGeneration?.file_format}
                      durationSeconds={currentGeneration?.duration_seconds}
                      onDownload={handleDownload}
                    />
                  )}

                  {isProjectMode && (
                    <AudioLibrary
                      items={savedGenerations}
                      voices={voices}
                      isLoading={isLoadingGenerations}
                      title="Project Audio Library"
                      description="Manage every saved audio clip in this project."
                      emptyTitle="No saved audio yet"
                      emptyDescription="Generate audio in this workspace and it will appear here with play, text, download, and delete actions."
                      searchPlaceholder="Search saved audio by script, voice, or project..."
                      onDelete={handleDeleteGeneration}
                      onUseText={handleUseSavedGeneration}
                    />
                  )}
                </div>

                {/* Right Column - Controls */}
                <div className="space-y-4">
                  {/* Voice Selection */}
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Voice</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {isLoadingVoices ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <Select value={voice} onValueChange={setVoice}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-48">
                            {voices.map((v) => (
                              <SelectItem
                                key={v.id}
                                value={v.id}
                                className="text-sm"
                              >
                                {v.name} ({v.language})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </CardContent>
                  </Card>

                  {/* Speed Control */}
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Speed</CardTitle>
                        <span className="text-xs font-medium bg-secondary px-1.5 py-0.5 rounded">
                          {speed.toFixed(1)}x
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Slider
                        value={[speed]}
                        onValueChange={(val: number[]) => setSpeed(val[0])}
                        min={0.5}
                        max={2}
                        step={0.1}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Slow</span>
                        <span>Fast</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Pitch Control */}
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Pitch</CardTitle>
                        <span className="text-xs font-medium bg-secondary px-1.5 py-0.5 rounded">
                          {pitch.toFixed(1)}x
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Slider
                        value={[pitch]}
                        onValueChange={(val: number[]) => setPitch(val[0])}
                        min={0.5}
                        max={2}
                        step={0.1}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Low</span>
                        <span>High</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Audio Format Control */}
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Audio Format</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Select
                        value={audioFormat}
                        onValueChange={setAudioFormat}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="wav">
                            WAV - Highest Quality
                          </SelectItem>
                          <SelectItem value="mp3">MP3 - Compressed</SelectItem>
                          <SelectItem value="ogg">OGG - Compressed</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-2">
                        WAV offers best quality, MP3/OGG are smaller files
                      </p>
                    </CardContent>
                  </Card>

                  {/* Sample Rate Control */}
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Sample Rate</CardTitle>
                        <span className="text-xs font-medium bg-secondary px-1.5 py-0.5 rounded">
                          {sampleRate} Hz
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Select
                        value={sampleRate.toString()}
                        onValueChange={(val: string) =>
                          setSampleRate(parseInt(val))
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16000">
                            16000 Hz - Low Quality
                          </SelectItem>
                          <SelectItem value="22050">
                            22050 Hz - Standard
                          </SelectItem>
                          <SelectItem value="44100">
                            44100 Hz - High Quality
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-2">
                        Higher rates = better quality but larger files
                      </p>
                    </CardContent>
                  </Card>

                  {/* Settings */}
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={handleClearState}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Clear State
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
