/**
 * Projects Management Component
 * Manage TTS projects integrated with backend API
 */

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Edit2,
  FolderKanban,
  Maximize2,
  Plus,
  Trash2,
} from "lucide-react";

import { apiClient, type ProjectSummary } from "../services/api";
import { useAuth } from "../services/auth";
import { KokoroStudio } from "./KokoroStudio";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

type Project = ProjectSummary;

const EMPTY_FORM = {
  name: "",
  description: "",
};

export function Projects() {
  const { hasValidActiveAccount, isLoading: authLoading } = useAuth();
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
  const [retryCount, setRetryCount] = useState(0);

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

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedProject]);

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
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err?.detail || "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditProject = (project: Project) => {
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
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err?.detail || "Failed to update project");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this project and its saved generations?",
    );
    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      await apiClient.deleteProject(projectId);

      setProjects((current) =>
        current.filter((project) => project.id !== projectId),
      );

      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
      }

      if (editingProject?.id === projectId) {
        setEditingProject(null);
      }

      setSuccess("Project deleted successfully!");
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      setError(err?.detail || "Failed to delete project");
    }
  };

  const getColorForProject = (index: number) => {
    const colors = [
      "bg-blue-500",
      "bg-cyan-500",
      "bg-emerald-500",
      "bg-amber-500",
      "bg-rose-500",
      "bg-indigo-500",
    ];
    return colors[index % colors.length];
  };

  return (
    <>
      <div className="min-h-[calc(100vh-3rem)] m-6 rounded-3xl overflow-hidden border border-border/50 bg-white shadow-sm">
        <div className="h-full space-y-8 overflow-y-auto p-6 md:p-8 lg:p-10">
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  Project Management
                </h1>
                <p className="mt-2 text-lg text-muted-foreground">
                  Create dedicated workspaces for saved generations, scripts,
                  and voice playback.
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
                      Create a new project to keep generated audio, drafts, and
                      scripts together.
                    </DialogDescription>
                  </DialogHeader>

                  <form onSubmit={handleCreateProject} className="space-y-4">
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

          {success && (
            <Alert className="border border-green-200 bg-green-50">
              <AlertDescription className="text-green-800">
                {success}
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="flex items-center justify-between border border-red-200 bg-red-50">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
                <AlertDescription className="text-red-800">
                  {error}
                </AlertDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadProjects()}
              >
                Try Again
              </Button>
            </Alert>
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
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((project, index) => (
                <Card
                  key={project.id}
                  className="group cursor-pointer transition-all hover:border-primary/50"
                >
                  <CardContent className="space-y-6 p-6">
                    <div className="flex items-start justify-between">
                      <button
                        type="button"
                        className={`flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-md ${getColorForProject(index)}`}
                        onClick={() => setSelectedProject(project)}
                        title="Open project"
                      >
                        <FolderKanban className="h-6 w-6" />
                      </button>

                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => openEditProject(project)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-600"
                          onClick={() => handleDeleteProject(project.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedProject(project)}
                      className="text-left"
                    >
                      <h3
                        className="line-clamp-2 text-lg font-semibold transition-colors hover:text-primary"
                        title={project.name}
                      >
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                          {project.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="bg-secondary/50 text-xs font-normal"
                        >
                          Workspace Ready
                        </Badge>
                      </div>
                    </button>

                    <div className="flex items-center justify-between border-t border-border/50 pt-4">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {formatDistanceToNow(new Date(project.updated_at), {
                          addSuffix: true,
                        })}
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
              ))}
            </div>
          )}
        </div>
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

      {selectedProject && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="flex h-full flex-col">
            <div className="border-b border-border/50 bg-card/70 px-6 py-4 backdrop-blur">
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
                      Full Screen Workspace
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
                  <Badge variant="secondary" className="bg-secondary/60">
                    Updated{" "}
                    {formatDistanceToNow(new Date(selectedProject.updated_at), {
                      addSuffix: true,
                    })}
                  </Badge>
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
                    onClick={() => handleDeleteProject(selectedProject.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Project
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <KokoroStudio
                preSelectedProjectId={selectedProject.id}
                lockProjectSelection
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
