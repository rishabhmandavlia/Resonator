/**
 * History Page Component
 * Display saved generation history across all projects with advanced filtering.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Search, Filter, X } from "lucide-react";

import { AudioLibrary, type AudioLibraryItem } from "./AudioLibrary";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  apiClient,
  type StoredGeneration,
  type VoiceOption,
  type ProjectSummary,
  type FilteredGenerationsResponse,
} from "../services/api";
import { useAuth } from "../services/auth";

interface FilterState {
  searchText: string;
  projectId: string | null;
  voiceId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  minDuration: number | null;
  maxDuration: number | null;
  sortBy: string;
  sortOrder: string;
}

const ALL_PROJECTS_VALUE = "__all_projects__";
const ALL_VOICES_VALUE = "__all_voices__";

const ELEVATED_FIELD_CLASS_NAME =
  "border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.06)] hover:border-slate-300 focus-visible:border-slate-300";

export function HistoryPage() {
  const { hasValidActiveAccount } = useAuth();
  const [history, setHistory] = useState<StoredGeneration[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [filters, setFilters] = useState<FilterState>({
    searchText: "",
    projectId: null,
    voiceId: null,
    dateFrom: null,
    dateTo: null,
    minDuration: null,
    maxDuration: null,
    sortBy: "created_at",
    sortOrder: "desc",
  });

  // Load available voices and projects
  useEffect(() => {
    if (!hasValidActiveAccount) {
      setHistory([]);
      setTotalCount(0);
      setError(null);
      setIsLoading(false);
      return;
    }
    loadMetadata();
  }, [hasValidActiveAccount]);

  // Load filtered history whenever filters or page changes
  useEffect(() => {
    if (!hasValidActiveAccount) {
      return;
    }
    loadFilteredHistory();
  }, [hasValidActiveAccount, page, filters]);

  const loadMetadata = async () => {
    try {
      const [availableVoices, userProjects] = await Promise.all([
        apiClient.getAvailableVoices(),
        apiClient.listProjects(),
      ]);
      setVoices(availableVoices);
      setProjects(userProjects);
    } catch (err: any) {
      console.error("Failed to load metadata:", err);
    }
  };

  const loadFilteredHistory = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const data: FilteredGenerationsResponse =
        await apiClient.searchGenerations({
          projectId: filters.projectId,
          voiceId: filters.voiceId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          minDuration:
            filters.minDuration !== null ? filters.minDuration : undefined,
          maxDuration:
            filters.maxDuration !== null ? filters.maxDuration : undefined,
          searchText: filters.searchText,
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder,
          skip: page * pageSize,
          limit: pageSize,
        });

      // Add project names to generations
      setHistory(data.generations);
      setTotalCount(data.total_count);
    } catch (err: any) {
      setError(err?.detail || "Failed to load generation history");
      setHistory([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteGeneration = async (generation: AudioLibraryItem) => {
    if (!generation.project_id) {
      return;
    }

    try {
      await apiClient.deleteGeneration(generation.project_id, generation.id);
      // Reload history after deletion
      await loadFilteredHistory();
    } catch (err) {
      console.error("Failed to delete generation:", err);
    }
  };

  const handleResetFilters = () => {
    setPage(0);
    setFilters({
      searchText: "",
      projectId: null,
      voiceId: null,
      dateFrom: null,
      dateTo: null,
      minDuration: null,
      maxDuration: null,
      sortBy: "created_at",
      sortOrder: "desc",
    });
  };

  const activeFilterCount = [
    filters.searchText,
    filters.projectId,
    filters.voiceId,
    filters.dateFrom,
    filters.dateTo,
    filters.minDuration,
    filters.maxDuration,
  ].filter((value) => value !== null && value !== "").length;

  const hasActiveFilters = activeFilterCount > 0;

  const itemsWithProjectNames = useMemo(
    () =>
      history.map((generation) => ({
        ...generation,
        project_name:
          generation.project_name ||
          projects.find((project) => project.id === generation.project_id)
            ?.name ||
          "Quick Generate",
      })),
    [history, projects],
  );

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="h-full p-6">
      <div className="flex h-full min-h-0 flex-col rounded-3xl border border-border/50 bg-white shadow-sm">
        <div className="flex-1 min-h-0 space-y-8 overflow-y-auto p-6 md:p-8 lg:p-10">
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  Generation History
                </h1>
                <p className="mt-2 text-lg text-muted-foreground">
                  Browse every saved voice generation across your projects and
                  quick generations.
                </p>
              </div>
            </div>
          </div>

          {/* Search and Filter Bar */}
          <div className="space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="Search by text prompt..."
                  value={filters.searchText}
                  onChange={(e) => {
                    setPage(0);
                    setFilters((prev) => ({
                      ...prev,
                      searchText: e.target.value,
                    }));
                  }}
                  className={`pl-10 ${ELEVATED_FIELD_CLASS_NAME}`}
                />
              </div>
              <Button
                variant={showFilters ? "default" : "outline"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                Filters
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
              <Badge variant="secondary" className="text-sm">
                {totalCount} generations
              </Badge>
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="space-y-4 rounded-lg border border-border/40 bg-slate-50/85 p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {/* Project Filter */}
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Project
                    </label>
                    <Select
                      value={filters.projectId || ALL_PROJECTS_VALUE}
                      onValueChange={(value: string) => {
                        setPage(0);
                        setFilters((prev) => ({
                          ...prev,
                          projectId:
                            value === ALL_PROJECTS_VALUE ? null : value,
                        }));
                      }}
                    >
                      <SelectTrigger className={ELEVATED_FIELD_CLASS_NAME}>
                        <SelectValue placeholder="All projects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_PROJECTS_VALUE}>
                          All projects
                        </SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Voice Filter */}
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Voice
                    </label>
                    <Select
                      value={filters.voiceId || ALL_VOICES_VALUE}
                      onValueChange={(value: string) => {
                        setPage(0);
                        setFilters((prev) => ({
                          ...prev,
                          voiceId: value === ALL_VOICES_VALUE ? null : value,
                        }));
                      }}
                    >
                      <SelectTrigger className={ELEVATED_FIELD_CLASS_NAME}>
                        <SelectValue placeholder="All voices" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VOICES_VALUE}>
                          All voices
                        </SelectItem>
                        {voices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Sort By */}
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Sort By
                    </label>
                    <Select
                      value={filters.sortBy}
                      onValueChange={(value: string) => {
                        setPage(0);
                        setFilters((prev) => ({
                          ...prev,
                          sortBy: value,
                        }));
                      }}
                    >
                      <SelectTrigger className={ELEVATED_FIELD_CLASS_NAME}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="created_at">Date Created</SelectItem>
                        <SelectItem value="duration_seconds">
                          Duration
                        </SelectItem>
                        <SelectItem value="text_prompt">Text</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Date From */}
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      From Date
                    </label>
                    <Input
                      type="date"
                      value={filters.dateFrom || ""}
                      onChange={(e) => {
                        setPage(0);
                        setFilters((prev) => ({
                          ...prev,
                          dateFrom: e.target.value || null,
                        }));
                      }}
                      className={ELEVATED_FIELD_CLASS_NAME}
                    />
                  </div>

                  {/* Date To */}
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      To Date
                    </label>
                    <Input
                      type="date"
                      value={filters.dateTo || ""}
                      onChange={(e) => {
                        setPage(0);
                        setFilters((prev) => ({
                          ...prev,
                          dateTo: e.target.value || null,
                        }));
                      }}
                      className={ELEVATED_FIELD_CLASS_NAME}
                    />
                  </div>

                  {/* Duration Range */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Min Duration (sec)
                    </label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="0"
                      value={filters.minDuration ?? ""}
                      onChange={(e) => {
                        setPage(0);
                        const value =
                          e.target.value === ""
                            ? null
                            : Math.max(0, parseFloat(e.target.value));
                        setFilters((prev) => ({
                          ...prev,
                          minDuration: value,
                        }));
                      }}
                      className={ELEVATED_FIELD_CLASS_NAME}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Max Duration (sec)
                    </label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="No limit"
                      value={filters.maxDuration ?? ""}
                      onChange={(e) => {
                        setPage(0);
                        const value =
                          e.target.value === ""
                            ? null
                            : Math.max(0, parseFloat(e.target.value));
                        setFilters((prev) => ({
                          ...prev,
                          maxDuration: value,
                        }));
                      }}
                      className={ELEVATED_FIELD_CLASS_NAME}
                    />
                  </div>
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetFilters}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Clear Filters
                  </Button>
                )}
              </div>
            )}
          </div>

          {error && (
            <Alert className="border border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="ml-2 text-red-800">
                {error}
              </AlertDescription>
            </Alert>
          )}

          <AudioLibrary
            items={itemsWithProjectNames}
            voices={voices}
            isLoading={isLoading}
            title="Filtered Generations"
            description="Play, inspect, download, or delete any saved audio clip."
            emptyTitle={
              totalCount === 0
                ? "No generations found"
                : "No generations on this page"
            }
            emptyDescription={
              totalCount === 0
                ? hasActiveFilters
                  ? "Try adjusting your filters to find generations."
                  : "Generate audio inside a project and it will appear here."
                : ""
            }
            showProjectName
            onDelete={handleDeleteGeneration}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                disabled={page === 0 || isLoading}
                onClick={() => setPage(Math.max(0, page - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages - 1 || isLoading}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
