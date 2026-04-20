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
  project_name?: string | null;
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

export interface FilteredGenerationsResponse {
  generations: StoredGeneration[];
  total_count: number;
  skip: number;
  limit: number;
}

export interface AuthProviderOption {
  id: string;
  displayName: string;
  isConfigured: boolean;
  supportsPrompt: boolean;
}

export interface SessionAccountSummary {
  accountId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isValid: boolean;
  invalidReason: string | null;
  providers: ConnectedProviderSummary[];
}

export interface ConnectedProviderSummary {
  type: string;
  label: string;
  isInSession: boolean;
  isValid: boolean;
  expiresAt: number | null;
}

export interface AuthSessionResponse {
  accounts: SessionAccountSummary[];
  activeAccountId: string | null;
}

export interface AuthProvidersResponse {
  providers: AuthProviderOption[];
}

export interface RegistrationChallengeResponse {
  email: string;
  message: string;
  expiresAt: string;
  resendAvailableAt: string;
  resendCooldownSeconds: number;
  resendAvailableInSeconds: number;
  verificationType: string;
  provider: string | null;
}

export interface CurrentUserResponse {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
  provider: string | null;
  account_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_valid: boolean;
  has_email_auth: boolean;
  is_email_verified: boolean;
}

export interface StatusResponse {
  message: string;
}

type RawFilteredGenerationsResponse = {
  generations: RawGenerationResponse[];
  total_count: number;
  skip: number;
  limit: number;
};

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

function normalizeApiDate(value?: string | null): string {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return new Date().toISOString();
  }

  if (
    /[zZ]$/.test(trimmedValue) ||
    /[+-]\d{2}:\d{2}$/.test(trimmedValue) ||
    !trimmedValue.includes("T")
  ) {
    return trimmedValue;
  }

  return `${trimmedValue}Z`;
}

function normalizeProjectResponse(project: ProjectSummary): ProjectSummary {
  return {
    ...project,
    created_at: normalizeApiDate(project.created_at),
    updated_at: normalizeApiDate(project.updated_at),
  };
}

function normalizeDraftResponse(draft: RawDraftResponse): DraftResponse {
  const createdAt = normalizeApiDate(draft.created_at || draft.saved_at);

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
  const createdAt = normalizeApiDate(response.created_at);

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
    project_name: response.project_name || null,
    file_format: response.file_format || "wav",
    duration_seconds: response.duration_seconds || 0,
    created_at: createdAt,
    updated_at: normalizeApiDate(response.updated_at || createdAt),
  };
}

function normalizeCurrentUserResponse(
  user: CurrentUserResponse,
): CurrentUserResponse {
  return {
    ...user,
    created_at: normalizeApiDate(user.created_at),
    updated_at: normalizeApiDate(user.updated_at),
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

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        credentials: "include",
        headers,
      });

      const responseText = await response.text();

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
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

  async getAuthProviders(): Promise<AuthProvidersResponse> {
    return this.request<AuthProvidersResponse>("/api/auth/providers", {
      method: "GET",
    });
  }

  async getAuthSession(): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/session", {
      method: "GET",
    });
  }

  getOAuthStartUrl(
    provider: string,
    options?: { addAccount?: boolean; prompt?: string },
  ): string {
    const params = new URLSearchParams();
    if (options?.addAccount) {
      params.set("add_account", "true");
    }
    if (options?.prompt) {
      params.set("prompt", options.prompt);
    }

    const suffix = params.toString();
    return `${this.baseUrl}/api/auth/oauth/${provider}/start${suffix ? `?${suffix}` : ""}`;
  }

  async switchAccount(accountId: string): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/switch", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
  }

  async removeAccount(accountId: string): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>(
      `/api/auth/accounts/${accountId}`,
      {
        method: "DELETE",
      },
    );
  }

  async logoutAll(): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/logout-all", {
      method: "POST",
    });
  }

  /**
   * Start email registration and send OTP
   */
  async register(
    email: string,
    password: string,
  ): Promise<RegistrationChallengeResponse> {
    return this.request<RegistrationChallengeResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Verify email registration OTP and attach the account to the current session
   */
  async verifyEmail(email: string, otp: string): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
  }

  /**
   * Resend the registration OTP
   */
  async resendOtp(email: string): Promise<RegistrationChallengeResponse> {
    return this.request<RegistrationChallengeResponse>("/api/auth/resend-otp", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Verify a pending OAuth email-link OTP and attach the provider to the current user session
   */
  async verifyOAuthLink(
    email: string,
    otp: string,
  ): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/verify-oauth-link", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
  }

  /**
   * Resend the OTP for a pending OAuth email-link flow
   */
  async resendOAuthLink(email: string): Promise<RegistrationChallengeResponse> {
    return this.request<RegistrationChallengeResponse>(
      "/api/auth/resend-oauth-link",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    );
  }

  /**
   * Login user and add the verified email account to the current session
   */
  async login(email: string, password: string): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<CurrentUserResponse> {
    const user = await this.request<CurrentUserResponse>("/api/auth/me", {
      method: "GET",
    });

    return normalizeCurrentUserResponse(user);
  }

  async updateCurrentUserProfile(
    displayName: string,
  ): Promise<CurrentUserResponse> {
    const user = await this.request<CurrentUserResponse>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName }),
    });

    return normalizeCurrentUserResponse(user);
  }

  async changeCurrentUserEmail(
    newEmail: string,
    currentPassword: string,
  ): Promise<CurrentUserResponse> {
    const user = await this.request<CurrentUserResponse>("/api/auth/me/email", {
      method: "POST",
      body: JSON.stringify({
        new_email: newEmail,
        current_password: currentPassword,
      }),
    });

    return normalizeCurrentUserResponse(user);
  }

  async changeCurrentUserPassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<StatusResponse> {
    return this.request<StatusResponse>("/api/auth/me/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  async deleteCurrentUserAccount(
    confirmation: string,
    currentPassword?: string,
  ): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({
        confirmation,
        current_password: currentPassword,
      }),
    });
  }

  /**
   * Logout user
   */
  async logout(): Promise<AuthSessionResponse> {
    return this.logoutAll();
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

    const projects = Array.isArray(response)
      ? response
      : response.projects || [];
    return projects.map(normalizeProjectResponse);
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
    const project = await this.request<ProjectSummary>(
      `/api/projects/${projectId}`,
      {
        method: "GET",
      },
    );
    return normalizeProjectResponse(project);
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
    const project = await this.request<ProjectSummary>("/api/projects/", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    return normalizeProjectResponse(project);
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
    const project = await this.request<ProjectSummary>(
      `/api/projects/${projectId}`,
      {
        method: "PUT",
        body: JSON.stringify({ name, description }),
      },
    );
    return normalizeProjectResponse(project);
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

    const targetUrl = new URL(audioPath, `${this.baseUrl}/`);
    const apiOrigin = new URL(this.baseUrl).origin;

    const response = await fetch(targetUrl.toString(), {
      credentials: targetUrl.origin === apiOrigin ? "include" : "omit",
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
        const targetUrl = new URL(audioPath, `${this.baseUrl}/`);
        const apiOrigin = new URL(this.baseUrl).origin;

        const response = await fetch(targetUrl.toString(), {
          credentials: targetUrl.origin === apiOrigin ? "include" : "omit",
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

  async searchGenerations(params: {
    projectId?: string | null;
    voiceId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    minDuration?: number | null;
    maxDuration?: number | null;
    searchText?: string | null;
    sortBy?: string;
    sortOrder?: string;
    skip?: number;
    limit?: number;
  }): Promise<FilteredGenerationsResponse> {
    const queryParams = new URLSearchParams();

    if (params.projectId) queryParams.append("project_id", params.projectId);
    if (params.voiceId) queryParams.append("voice_id", params.voiceId);
    if (params.dateFrom) queryParams.append("date_from", params.dateFrom);
    if (params.dateTo) queryParams.append("date_to", params.dateTo);
    if (params.minDuration !== null && params.minDuration !== undefined)
      queryParams.append("min_duration", params.minDuration.toString());
    if (params.maxDuration !== null && params.maxDuration !== undefined)
      queryParams.append("max_duration", params.maxDuration.toString());
    if (params.searchText) queryParams.append("search_text", params.searchText);

    queryParams.append("sort_by", params.sortBy || "created_at");
    queryParams.append("sort_order", params.sortOrder || "desc");
    queryParams.append("skip", (params.skip || 0).toString());
    queryParams.append("limit", (params.limit || 50).toString());

    const response = await this.request<RawFilteredGenerationsResponse>(
      `/api/projects/generations/search?${queryParams.toString()}`,
      {
        method: "GET",
      },
    );

    return {
      ...response,
      generations: response.generations.map((generation) =>
        normalizeGenerationResponse(generation),
      ),
    };
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
