/**
 * History Page Component
 * Display saved generation history across all projects.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Search } from "lucide-react";

import { AudioLibrary, type AudioLibraryItem } from "./AudioLibrary";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import {
  apiClient,
  type StoredGeneration,
  type VoiceOption,
} from "../services/api";

export function HistoryPage() {
  const [history, setHistory] = useState<StoredGeneration[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [projects, availableVoices] = await Promise.all([
        apiClient.listProjects(),
        apiClient.getAvailableVoices(),
      ]);

      setVoices(availableVoices);

      const generationGroups = await Promise.all(
        projects.map(async (project) => {
          try {
            const generations = await apiClient.listGenerations(project.id);
            return generations.map((generation) => ({
              ...generation,
              project_name: project.name,
            }));
          } catch (err) {
            console.error(
              `Failed to load generations for project ${project.id}:`,
              err,
            );
            return [] as StoredGeneration[];
          }
        }),
      );

      const allGenerations = generationGroups
        .flat()
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

      setHistory(allGenerations);
    } catch (err: any) {
      setError(err?.detail || "Failed to load generation history");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteGeneration = async (generation: AudioLibraryItem) => {
    if (!generation.project_id) {
      return;
    }

    await apiClient.deleteGeneration(generation.project_id, generation.id);
    setHistory((current) =>
      current.filter((item) => item.id !== generation.id),
    );
  };

  const filteredHistory = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return history;
    }

    return history.filter((item) =>
      [
        item.text_prompt || item.text,
        item.voice_id || "",
        item.project_name || "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [history, searchQuery]);

  return (
    <div className="min-h-[calc(100vh-3rem)] m-6 rounded-3xl overflow-hidden border border-border/50 bg-white shadow-sm">
      <div className="h-full space-y-8 overflow-y-auto p-6 md:p-8 lg:p-10">
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Generation History
              </h1>
              <p className="mt-2 text-lg text-muted-foreground">
                Browse every saved voice generation across your projects.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by text, voice, or project..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Badge variant="secondary" className="text-sm">
            {filteredHistory.length} saved audio
          </Badge>
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
          items={filteredHistory}
          voices={voices}
          isLoading={isLoading}
          title="All Saved Generations"
          description="Play, inspect, download, or delete any saved audio clip from your workspace history."
          emptyTitle={
            history.length === 0
              ? "No saved generations yet"
              : "No matching generations found"
          }
          emptyDescription={
            history.length === 0
              ? "Generate audio inside a project and it will appear here automatically."
              : "Try a different search term to find the generation you need."
          }
          showProjectName
          onDelete={handleDeleteGeneration}
        />
      </div>
    </div>
  );
}
