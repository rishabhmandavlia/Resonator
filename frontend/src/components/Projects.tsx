/**
 * Projects Management Component
 * Manage TTS projects integrated with backend API
 */

import {
  type MouseEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Clock,
  Edit2,
  FolderKanban,
  FolderOpen,
  Maximize2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { apiClient, type ProjectSummary } from "../services/api";
import { useAuth } from "../services/auth";
import { GenerationHelpBook } from "./GenerationHelpBook";
import { KokoroStudio } from "./KokoroStudio";
import { Alert, AlertDescription } from "./ui/alert";
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
import { Card, CardContent } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import { StatusToast } from "./ui/status-toast";

type Project = ProjectSummary;
type ProjectDateFilter = "updated-desc" | "created-desc" | "created-asc";

const PROJECT_COLOR_CLASSES = [
  "bg-gradient-to-br from-sky-500 to-cyan-500",
  "bg-gradient-to-br from-emerald-500 to-teal-500",
  "bg-gradient-to-br from-amber-500 to-orange-500",
  "bg-gradient-to-br from-rose-500 to-pink-500",
  "bg-gradient-to-br from-violet-500 to-indigo-500",
  "bg-gradient-to-br from-fuchsia-500 to-purple-500",
] as const;

const EMPTY_FORM = {
  name: "",
  description: "",
};

const DEFAULT_DATE_FILTER: ProjectDateFilter = "updated-desc";

function getColorForProject(index: number) {
  return PROJECT_COLOR_CLASSES[index % PROJECT_COLOR_CLASSES.length];
}

export function Projects() {
  const { hasValidActiveAccount, isLoading: authLoading, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editFormData, setEditFormData] = useState(EMPTY_FORM);
  const [isUpdating, setIsUpdating] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] =
    useState<Project | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteProjectAudioFiles, setDeleteProjectAudioFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] =
    useState<ProjectDateFilter>(DEFAULT_DATE_FILTER);
  const [retryCount, setRetryCount] = useState(0);
  const clearToast = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  const handleProjectActivity = useCallback(
    (projectId: string, updatedAt: string) => {
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId
            ? { ...project, updated_at: updatedAt }
            : project,
        ),
      );
      setSelectedProject((current) =>
        current && current.id === projectId
          ? { ...current, updated_at: updatedAt }
          : current,
      );
    },
    [],
  );

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedProjectQuery = deferredSearchQuery.trim().toLowerCase();

  useEffect(() => {
    if (!authLoading && hasValidActiveAccount) {
      loadProjects();
    }
  }, [authLoading, hasValidActiveAccount]);

  useEffect(() => {
    if (retryCount > 0 && hasValidActiveAccount) {
      loadProjects();
    }
  }, [retryCount, hasValidActiveAccount]);

  useEffect(() => {
    if (!authLoading && !hasValidActiveAccount) {
      setProjects([]);
      setSelectedProject(null);
      setEditingProject(null);
      setError(null);
      setIsLoading(false);
    }
  }, [authLoading, hasValidActiveAccount]);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loaded = await apiClient.listProjects();
      setProjects(loaded);
      setRetryCount(0);
    } catch (err: any) {
      const errorMessage = err?.detail || "Failed to load projects";
      setError(errorMessage);

      if (retryCount < 1) {
        setTimeout(() => {
          setRetryCount((current) => current + 1);
        }, 1500);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newProject = await apiClient.createProject(
        formData.name,
        formData.description || undefined,
      );

      setProjects((current) => [newProject, ...current]);
      setFormData(EMPTY_FORM);
      setIsCreateDialogOpen(false);
      setSuccess("Project created successfully!");
    } catch (err: any) {
      setError(err?.detail || "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditProject = (project: Project) => {
    if (project.user_id !== user?.id) {
      setError("Only the project owner can edit this project.");
      return;
    }

    setEditingProject(project);
    setEditFormData({
      name: project.name,
      description: project.description || "",
    });
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingProject || !editFormData.name.trim()) {
      setError("Project name is required");
      return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      const updatedProject = await apiClient.updateProject(
        editingProject.id,
        editFormData.name,
        editFormData.description || undefined,
      );

      setProjects((current) =>
        current.map((project) =>
          project.id === updatedProject.id ? updatedProject : project,
        ),
      );

      if (selectedProject?.id === updatedProject.id) {
        setSelectedProject(updatedProject);
      }

      setEditingProject(null);
      setSuccess("Project updated successfully!");
    } catch (err: any) {
      setError(err?.detail || "Failed to update project");
    } finally {
      setIsUpdating(false);
    }
  };

  const requestDeleteProject = (project: Project) => {
    if (project.user_id !== user?.id) {
      setError("Only the project owner can delete this project.");
      return;
    }

    setDeleteError(null);
    setDeleteProjectAudioFiles(false);
    setProjectPendingDelete(project);
  };

  const handleDeleteProject = async () => {
    if (!projectPendingDelete) {
      return;
    }

    const projectId = projectPendingDelete.id;

    setIsDeletingProject(true);
    setDeleteError(null);

    try {
      setError(null);
      await apiClient.deleteProject(projectId, {
        deleteAudioFiles: deleteProjectAudioFiles,
      });

      setProjects((current) =>
        current.filter((project) => project.id !== projectId),
      );

      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
      }

      if (editingProject?.id === projectId) {
        setEditingProject(null);
      }

      setProjectPendingDelete(null);
      setDeleteProjectAudioFiles(false);
      setSuccess("Project deleted successfully!");
    } catch (err: any) {
      const message = err?.detail || "Failed to delete project";
      setDeleteError(message);
      setError(message);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const isOwnedProject = (project: Project | null) =>
    project !== null && project.user_id === user?.id;

  const visibleProjects = [...projects]
    .filter((project) => {
      if (!normalizedProjectQuery) {
        return true;
      }

      return project.name.toLowerCase().includes(normalizedProjectQuery);
    })
    .sort((left, right) => {
      switch (dateFilter) {
        case "created-desc":
          return (
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime()
          );
        case "created-asc":
          return (
            new Date(left.created_at).getTime() -
            new Date(right.created_at).getTime()
          );
        case "updated-desc":
        default:
          return (
            new Date(right.updated_at).getTime() -
            new Date(left.updated_at).getTime()
          );
      }
    });

  const hasProjectMatches = visibleProjects.length > 0;
  const hasProjectFilters =
    searchQuery.trim().length > 0 || dateFilter !== DEFAULT_DATE_FILTER;
  const toastNotice =
    error !== null
      ? { tone: "error" as const, message: error }
      : success !== null
        ? { tone: "success" as const, message: success }
        : null;

  return (
    <>
      <div className="h-full p-6">
        {!selectedProject ? (
          <div className="flex h-full min-h-0 flex-col rounded-3xl border border-border/50 bg-white shadow-sm">
            <div className="flex-1 min-h-0 space-y-8 overflow-y-auto p-6 md:p-8 lg:p-10">
              <div className="flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                      Project Management
                    </h1>
                    <p className="mt-2 text-lg text-muted-foreground">
                      Create dedicated workspaces for saved generations,
                      scripts, and voice playback.
                    </p>
                  </div>

                  <Dialog
                    open={isCreateDialogOpen}
                    onOpenChange={setIsCreateDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button className="h-11 gap-2 bg-primary px-6 text-primary-foreground hover:bg-primary/90">
                        <Plus className="h-5 w-5" />
                        New Project
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create New Project</DialogTitle>
                        <DialogDescription>
                          Create a new project to keep generated audio and
                          scripts together.
                        </DialogDescription>
                      </DialogHeader>

                      <form
                        onSubmit={handleCreateProject}
                        className="space-y-4"
                      >
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Project Name
                          </label>
                          <Input
                            placeholder="e.g., Podcast Episode"
                            value={formData.name}
                            onChange={(e) =>
                              setFormData({ ...formData, name: e.target.value })
                            }
                            disabled={isSubmitting}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Description (Optional)
                          </label>
                          <Textarea
                            placeholder="Describe the purpose of this project..."
                            value={formData.description}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                description: e.target.value,
                              })
                            }
                            disabled={isSubmitting}
                            className="h-24"
                          />
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsCreateDialogOpen(false)}
                            disabled={isSubmitting}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Creating..." : "Create Project"}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {!isLoading && projects.length > 0 && (
                <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-center">
                      <div className="relative flex-1">
                        <Input
                          value={searchQuery}
                          onChange={(event) =>
                            setSearchQuery(event.target.value)
                          }
                          placeholder="Search projects by name"
                          className="pl-10"
                        />
                      </div>

                      <Select
                        value={dateFilter}
                        onValueChange={(value: ProjectDateFilter) =>
                          setDateFilter(value)
                        }
                      >
                        <SelectTrigger className="w-full md:w-[220px]">
                          <SelectValue placeholder="Sort by date" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="updated-desc">
                            Recently updated
                          </SelectItem>
                          <SelectItem value="created-desc">
                            Recently created
                          </SelectItem>
                          <SelectItem value="created-asc">
                            Oldest created
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {visibleProjects.length} of {projects.length} projects
                      </span>
                      {hasProjectFilters && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSearchQuery("");
                            setDateFilter(DEFAULT_DATE_FILTER);
                          }}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-gray-600">Loading projects...</p>
                </div>
              ) : projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-12">
                  <FolderKanban className="mb-4 h-12 w-12 text-gray-400" />
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    No projects yet
                  </h3>
                  <p className="mb-4 text-gray-600">
                    Create your first project to start storing generations.
                  </p>
                  <Button
                    className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => setIsCreateDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Create Project
                  </Button>
                </div>
              ) : !hasProjectMatches ? (
                <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-12 text-center">
                  <Search className="mb-4 h-12 w-12 text-gray-400" />
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">
                    No projects match the current filters
                  </h3>
                  <p className="mb-4 max-w-xl text-gray-600">
                    Adjust the project name search or change the date filter to
                    surface a different workspace.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery("");
                      setDateFilter(DEFAULT_DATE_FILTER);
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleProjects.map((project, index) => {
                    const isOwned = isOwnedProject(project);

                    return (
                      <Card
                        key={project.id}
                        className="group cursor-pointer transition-all hover:border-primary/50"
                      >
                        <CardContent className="space-y-6 p-6">
                          <div className="flex items-start gap-4">
                            <button
                              type="button"
                              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-gradient-to-br from-slate-50 to-slate-100 text-slate-700 shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
                              onClick={() => setSelectedProject(project)}
                              title="Open project"
                            >
                              <FolderOpen className="h-6 w-6 shrink-0 stroke-[2.1]" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setSelectedProject(project)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <h3
                                  className="line-clamp-2 text-lg font-semibold leading-snug transition-colors hover:text-primary"
                                  title={project.name}
                                >
                                  {project.name}
                                </h3>
                              </div>

                              {project.description && (
                                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                                  {project.description}
                                </p>
                              )}

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {!isOwned && (
                                  <Badge variant="outline" className="text-xs">
                                    Shared
                                  </Badge>
                                )}
                              </div>
                            </button>
                          </div>

                          <div className="flex items-center justify-between border-t border-border/50 pt-4">
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {formatDistanceToNow(
                                new Date(project.updated_at),
                                {
                                  addSuffix: true,
                                },
                              )}
                            </div>

                            <Button
                              size="sm"
                              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                              onClick={() => setSelectedProject(project)}
                            >
                              <Maximize2 className="h-4 w-4" />
                              Open
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-white shadow-sm">
            <div className="border-b border-border/50 bg-card/80 px-6 py-5 backdrop-blur md:px-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedProject(null)}
                    title="Back to projects"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>

                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                      Project Workspace
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold text-foreground">
                      {selectedProject.name}
                    </h1>
                    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                      {selectedProject.description ||
                        "Generate, review, play, and manage saved audio inside this project."}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <GenerationHelpBook triggerLabel="Writing guide" />
                  {!isOwnedProject(selectedProject) && (
                    <Badge variant="outline">Shared Project</Badge>
                  )}
                  <Badge variant="secondary" className="bg-secondary/60">
                    Updated{" "}
                    {formatDistanceToNow(new Date(selectedProject.updated_at), {
                      addSuffix: true,
                    })}
                  </Badge>
                  {isOwnedProject(selectedProject) && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => openEditProject(selectedProject)}
                      >
                        <Edit2 className="mr-2 h-4 w-4" />
                        Edit Project
                      </Button>
                      <Button
                        variant="outline"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => requestDeleteProject(selectedProject)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Project
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden bg-background">
              <KokoroStudio
                preSelectedProjectId={selectedProject.id}
                lockProjectSelection
                showWritingGuideTrigger={false}
                onProjectActivity={(updatedAt) =>
                  handleProjectActivity(selectedProject.id, updatedAt)
                }
              />
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={editingProject !== null}
        onOpenChange={(open: boolean) => !open && setEditingProject(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update your project name and description.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateProject} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Project Name
              </label>
              <Input
                placeholder="Project name"
                value={editFormData.name}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, name: e.target.value })
                }
                disabled={isUpdating}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Description (Optional)
              </label>
              <Textarea
                placeholder="Describe your project..."
                value={editFormData.description}
                onChange={(e) =>
                  setEditFormData({
                    ...editFormData,
                    description: e.target.value,
                  })
                }
                disabled={isUpdating}
                className="h-24"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingProject(null)}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={projectPendingDelete !== null}
        onOpenChange={(open: boolean) => {
          if (!open && !isDeletingProject) {
            setProjectPendingDelete(null);
            setDeleteProjectAudioFiles(false);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              {projectPendingDelete
                ? `Delete ${projectPendingDelete.name} and its saved generations? This action cannot be undone.`
                : "Delete this project and its saved generations? This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError && (
            <Alert className="border border-red-200 bg-red-50">
              <AlertDescription className="text-red-800">
                {deleteError}
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
            <label
              htmlFor="delete-project-audio-files"
              className="flex cursor-pointer items-start gap-3"
            >
              <Checkbox
                id="delete-project-audio-files"
                checked={deleteProjectAudioFiles}
                disabled={isDeletingProject}
                onCheckedChange={(checked: boolean | "indeterminate") =>
                  setDeleteProjectAudioFiles(checked === true)
                }
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Also delete generated audio files
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Leave this unchecked to keep the stored audio files.
                </p>
              </div>
            </label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingProject}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isDeletingProject}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                void handleDeleteProject();
              }}
            >
              {isDeletingProject ? "Deleting..." : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
