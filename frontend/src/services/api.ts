/**
 * API Client for AI Voice Generator Backend
 * Handles all HTTP requests to the backend API
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface ApiError {
  detail?: string;
  message?: string;
  error?: string;
  status?: number;
}

export interface ProjectSummary {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender: string;
}

export interface DraftResponse {
  id: string;
  project_id: string;
  generation_id: string | null;
  text_prompt: string;
  voice_id: string | null;
  speed: number;
  pitch: number;
  saved_at: string;
  created_at: string;
  audio_url?: string | null;
  status: "success" | "pending" | "failed";
  duration_seconds: number | null;
}

export interface GenerationResponse {
  id: string;
  project_id: string | null;
  user_id: string;
  text: string;
  text_prompt: string;
  voice_id: string | null;
  audio_path: string | null;
  audio_file_path: string | null;
  audio_url: string | null;
  title: string | null;
  folder_id: string | null;
  file_format: string;
  duration_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface StoredGeneration extends GenerationResponse {
  project_name?: string | null;
}

type RawDraftResponse = {
  id: string;
  project_id: string;
  generation_id: string | null;
  text_prompt: string;
  voice_id: string | null;
  speed: number;
  pitch: number;
  saved_at: string;
  created_at?: string;
  audio_url?: string | null;
  status?: "success" | "pending" | "failed";
  duration_seconds?: number | null;
};

type RawGenerationResponse = Partial<GenerationResponse> & {
  id: string;
  user_id: string;
};

function normalizeDraftResponse(draft: RawDraftResponse): DraftResponse {
  const createdAt = draft.created_at || draft.saved_at;

  return {
    ...draft,
    created_at: createdAt,
    status: draft.status || (draft.audio_url ? "success" : "pending"),
    duration_seconds:
      typeof draft.duration_seconds === "number"
        ? draft.duration_seconds
        : null,
  };
}

function normalizeGenerationResponse(
  response: RawGenerationResponse,
): GenerationResponse {
  const textPrompt = response.text_prompt || response.text || "";
  const audioPath = response.audio_file_path || response.audio_path || null;
  const createdAt = response.created_at || new Date().toISOString();

  return {
    id: response.id,
    project_id: response.project_id || null,
    user_id: response.user_id,
    text: response.text || textPrompt,
    text_prompt: textPrompt,
    voice_id: response.voice_id || null,
    audio_path: response.audio_path || audioPath,
    audio_file_path: audioPath,
    audio_url: response.audio_url || null,
    title: response.title || null,
    folder_id: response.folder_id || null,
    file_format: response.file_format || "wav",
    duration_seconds: response.duration_seconds || 0,
    created_at: createdAt,
    updated_at: response.updated_at || createdAt,
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make HTTP request with automatic error handling and authentication
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const token = localStorage.getItem("access_token");

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const responseText = await response.text();

      if (response.status === 401) {
        localStorage.removeItem("access_token");
        window.location.href = "/login";
      }

      if (!response.ok) {
        let parsedError: ApiError = {};
        try {
          parsedError = responseText ? JSON.parse(responseText) : {};
        } catch {
          parsedError = { detail: responseText };
        }

        const error = {
          status: response.status,
          detail:
            parsedError.detail ||
            parsedError.message ||
            parsedError.error ||
            response.statusText ||
            responseText ||
            "Request failed",
        };

        if (response.status !== 403) {
          console.error("API Error Response:", {
            url,
            status: response.status,
            body: responseText,
          });
        }
        throw error;
      }

      if (response.status === 204 || !responseText) {
        return {} as T;
      }

      return JSON.parse(responseText) as T;
    } catch (error) {
      if ((error as ApiError)?.status !== 403) {
        console.error("API request failed:", error);
      }
      throw error;
    }
  }

  // ==================== AUTH ENDPOINTS ====================

  /**
   * Register a new user
   */
  async register(
    email: string,
    password: string,
  ): Promise<{ access_token: string; token_type: string }> {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Login user
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ access_token: string; token_type: string }> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<{ id: string; email: string }> {
    return this.request("/api/auth/me", {
      method: "GET",
    });
  }

  /**
   * Logout user
   */
  logout(): void {
    localStorage.removeItem("access_token");
  }

  // ==================== PROJECT ENDPOINTS ====================

  /**
   * List all projects for current user
   */
  async listProjects(): Promise<ProjectSummary[]> {
    const response = await this.request<
      | ProjectSummary[]
      | {
          projects: ProjectSummary[];
        }
    >("/api/projects/", {
      method: "GET",
    });

    return Array.isArray(response) ? response : response.projects || [];
  }

  /**
   * Get single project
   */
  async getProject(projectId: string): Promise<{
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  }> {
    return this.request(`/api/projects/${projectId}`, {
      method: "GET",
    });
  }

  /**
   * Create new project
   */
  async createProject(
    name: string,
    description?: string,
  ): Promise<{
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  }> {
    return this.request("/api/projects/", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  /**
   * Update project
   */
  async updateProject(
    projectId: string,
    name?: string,
    description?: string,
  ): Promise<{
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  }> {
    return this.request(`/api/projects/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ name, description }),
    });
  }

  /**
   * Delete project
   */
  async deleteProject(projectId: string): Promise<void> {
    return this.request(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
  }

  // ==================== FOLDER ENDPOINTS ====================

  /**
   * List folders in project
   */
  async listFolders(projectId: string): Promise<
    Array<{
      id: string;
      project_id: string;
      parent_folder_id: string | null;
      name: string;
      created_at: string;
      updated_at: string;
    }>
  > {
    return this.request(`/api/projects/${projectId}/folders`, {
      method: "GET",
    });
  }

  /**
   * Create folder
   */
  async createFolder(
    projectId: string,
    name: string,
    parentFolderId?: string,
  ): Promise<{
    id: string;
    project_id: string;
    parent_folder_id: string | null;
    name: string;
    created_at: string;
    updated_at: string;
  }> {
    return this.request(`/api/projects/${projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({
        name,
        parent_folder_id: parentFolderId,
      }),
    });
  }

  /**
   * Delete folder
   */
  async deleteFolder(projectId: string, folderId: string): Promise<void> {
    return this.request(`/api/projects/${projectId}/folders/${folderId}`, {
      method: "DELETE",
    });
  }

  // ==================== COLLECTION ENDPOINTS ====================

  /**
   * List collections in project
   */
  async listCollections(projectId: string): Promise<
    Array<{
      id: string;
      project_id: string;
      name: string;
      description: string | null;
      color: string;
      created_at: string;
      updated_at: string;
    }>
  > {
    return this.request(`/api/projects/${projectId}/collections`, {
      method: "GET",
    });
  }

  /**
   * Create collection
   */
  async createCollection(
    projectId: string,
    name: string,
    description?: string,
    color?: string,
  ): Promise<{
    id: string;
    project_id: string;
    name: string;
    description: string | null;
    color: string;
    created_at: string;
    updated_at: string;
  }> {
    return this.request(`/api/projects/${projectId}/collections`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description,
        color: color || "#3b82f6",
      }),
    });
  }

  /**
   * Add generation to collection
   */
  async addToCollection(
    projectId: string,
    collectionId: string,
    generationId: string,
  ): Promise<{ status: string }> {
    return this.request(
      `/api/projects/${projectId}/collections/${collectionId}/audios/${generationId}`,
      {
        method: "POST",
      },
    );
  }

  /**
   * Remove generation from collection
   */
  async removeFromCollection(
    projectId: string,
    collectionId: string,
    generationId: string,
  ): Promise<void> {
    return this.request(
      `/api/projects/${projectId}/collections/${collectionId}/audios/${generationId}`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Delete collection
   */
  async deleteCollection(
    projectId: string,
    collectionId: string,
  ): Promise<void> {
    return this.request(
      `/api/projects/${projectId}/collections/${collectionId}`,
      {
        method: "DELETE",
      },
    );
  }

  // ==================== TAG ENDPOINTS ====================

  /**
   * List tags in project
   */
  async listTags(projectId: string): Promise<
    Array<{
      id: string;
      project_id: string;
      name: string;
      color: string;
      created_at: string;
    }>
  > {
    return this.request(`/api/projects/${projectId}/tags`, {
      method: "GET",
    });
  }

  /**
   * Create tag
   */
  async createTag(
    projectId: string,
    name: string,
    color?: string,
  ): Promise<{
    id: string;
    project_id: string;
    name: string;
    color: string;
    created_at: string;
  }> {
    return this.request(`/api/projects/${projectId}/tags`, {
      method: "POST",
      body: JSON.stringify({
        name,
        color: color || "#10b981",
      }),
    });
  }

  /**
   * Add tag to generation
   */
  async tagGeneration(
    generationId: string,
    tagId: string,
  ): Promise<{ status: string }> {
    return this.request(`/api/projects/audios/${generationId}/tags/${tagId}`, {
      method: "POST",
    });
  }

  /**
   * Remove tag from generation
   */
  async removeTag(generationId: string, tagId: string): Promise<void> {
    return this.request(`/api/projects/audios/${generationId}/tags/${tagId}`, {
      method: "DELETE",
    });
  }

  /**
   * Delete tag
   */
  async deleteTag(projectId: string, tagId: string): Promise<void> {
    return this.request(`/api/projects/${projectId}/tags/${tagId}`, {
      method: "DELETE",
    });
  }

  // ==================== DRAFT ENDPOINTS ====================

  /**
   * List drafts in project
   */
  async listDrafts(projectId: string): Promise<DraftResponse[]> {
    const drafts = await this.request<RawDraftResponse[]>(
      `/api/projects/${projectId}/drafts`,
      {
        method: "GET",
      },
    );

    return drafts.map(normalizeDraftResponse);
  }

  /**
   * Save draft
   */
  async saveDraft(
    projectId: string,
    textPrompt: string,
    voiceId?: string,
    speed?: number,
    pitch?: number,
    generationId?: string,
  ): Promise<DraftResponse> {
    const draft = await this.request<RawDraftResponse>(
      `/api/projects/${projectId}/drafts`,
      {
        method: "POST",
        body: JSON.stringify({
          text_prompt: textPrompt,
          voice_id: voiceId,
          speed: speed || 1.0,
          pitch: pitch || 1.0,
          generation_id: generationId,
        }),
      },
    );

    return normalizeDraftResponse(draft);
  }

  /**
   * Delete draft
   */
  async deleteDraft(projectId: string, draftId: string): Promise<void> {
    return this.request(`/api/projects/${projectId}/drafts/${draftId}`, {
      method: "DELETE",
    });
  }

  // ==================== ANALYTICS ENDPOINTS ====================

  /**
   * Get project analytics
   */
  async getAnalytics(projectId: string): Promise<{
    project_id: string;
    total_generations: number;
    total_duration_seconds: number;
    total_characters: number;
    last_modified: string;
  }> {
    return this.request(`/api/projects/${projectId}/analytics`, {
      method: "GET",
    });
  }

  // ==================== VOICE & TTS ENDPOINTS ====================

  /**
   * Get list of available Kokoro voices
   */
  async getAvailableVoices(): Promise<VoiceOption[]> {
    return this.request(`/api/projects/voices/available`, {
      method: "GET",
    });
  }

  /**
   * Generate audio from text using Kokoro TTS
   */
  async generateAudio(
    projectId: string,
    text: string,
    voiceId: string,
    speed?: number,
    pitch?: number,
    folderId?: string,
    title?: string,
  ): Promise<GenerationResponse> {
    // Use standalone endpoint if no project or empty project ID
    const endpoint =
      !projectId || projectId === "standalone"
        ? "/api/projects/generate/standalone"
        : `/api/projects/${projectId}/generate`;

    const generation = await this.request<RawGenerationResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        speed: speed || 1.0,
        pitch: pitch || 1.0,
        folder_id: folderId,
        title,
      }),
    });

    return normalizeGenerationResponse(generation);
  }

  /**
   * List saved generations in a project
   */
  async listGenerations(projectId: string): Promise<StoredGeneration[]> {
    const generations = await this.request<RawGenerationResponse[]>(
      `/api/projects/${projectId}/generations`,
      {
        method: "GET",
      },
    );

    return generations.map(normalizeGenerationResponse);
  }

  /**
   * Delete a saved generation from a project
   */
  async deleteGeneration(
    projectId: string,
    generationId: string,
  ): Promise<void> {
    return this.request(
      `/api/projects/${projectId}/generations/${generationId}`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Resolve an audio URL into a local blob URL using authenticated fetch.
   */
  async resolveAudioUrl(audioPath: string): Promise<string> {
    if (!audioPath) {
      throw new Error("Audio path is required");
    }

    if (audioPath.startsWith("blob:") || audioPath.startsWith("data:")) {
      return audioPath;
    }

    const token = localStorage.getItem("access_token");
    const headers: HeadersInit = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const targetUrl = new URL(audioPath, `${this.baseUrl}/`);
    const apiOrigin = new URL(this.baseUrl).origin;
    const requestHeaders = targetUrl.origin === apiOrigin ? headers : {};

    const response = await fetch(targetUrl.toString(), {
      headers: requestHeaders,
    });
    if (!response.ok) {
      throw new Error(`Failed to load audio: ${response.statusText}`);
    }

    const blob = await response.blob();
    return window.URL.createObjectURL(blob);
  }

  /**
   * Download audio file
   */
  async downloadAudio(audioPath: string, filename: string): Promise<void> {
    try {
      if (audioPath.startsWith("blob:") || audioPath.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = audioPath;
        a.download = filename || "audio.wav";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      try {
        const token = localStorage.getItem("access_token");
        const headers: HeadersInit = {};

        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const targetUrl = new URL(audioPath, `${this.baseUrl}/`);
        const apiOrigin = new URL(this.baseUrl).origin;
        const requestHeaders = targetUrl.origin === apiOrigin ? headers : {};

        const response = await fetch(targetUrl.toString(), {
          headers: requestHeaders,
        });

        if (!response.ok) {
          throw new Error(`Failed to download audio: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "audio.wav";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        window.URL.revokeObjectURL(url);
      } catch {
        const a = document.createElement("a");
        a.href = audioPath;
        a.download = filename || "audio.wav";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error("Failed to download audio:", error);
      throw error;
    }
  }

  /**
   * Get generation details
   */
  async getGeneration(
    projectId: string,
    generationId: string,
  ): Promise<GenerationResponse> {
    const generation = await this.request<RawGenerationResponse>(
      `/api/projects/${projectId}/generations/${generationId}`,
      {
        method: "GET",
      },
    );

    return normalizeGenerationResponse(generation);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
