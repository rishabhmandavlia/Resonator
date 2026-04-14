/**
 * Authentication Context and Provider
 * Manages multi-account OAuth session state and account switching.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  apiClient,
  type AuthProviderOption,
  type ConnectedProviderSummary,
  type AuthSessionResponse,
  type RegistrationChallengeResponse,
  type SessionAccountSummary,
} from "./api";

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  accountId: string;
  avatarUrl: string | null;
  isValid: boolean;
  invalidReason: string | null;
  providers: ConnectedProviderSummary[];
}

export interface AuthContextType {
  user: User | null;
  activeAccount: SessionAccountSummary | null;
  accounts: SessionAccountSummary[];
  activeAccountId: string | null;
  providers: AuthProviderOption[];
  isAuthenticated: boolean;
  hasValidActiveAccount: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
  ) => Promise<RegistrationChallengeResponse>;
  verifyEmail: (email: string, otp: string) => Promise<void>;
  resendOtp: (email: string) => Promise<RegistrationChallengeResponse>;
  verifyOAuthLink: (email: string, otp: string) => Promise<void>;
  resendOAuthLink: (email: string) => Promise<RegistrationChallengeResponse>;
  beginOAuthLogin: (
    provider: string,
    options?: { addAccount?: boolean },
  ) => void;
  switchAccount: (accountId: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  logoutAccount: (accountId: string) => Promise<void>;
  logoutCurrentAccount: () => Promise<void>;
  logout: (accountId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshSession: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function applySessionState(
  session: AuthSessionResponse,
  setAccounts: React.Dispatch<React.SetStateAction<SessionAccountSummary[]>>,
  setActiveAccountId: React.Dispatch<React.SetStateAction<string | null>>,
) {
  setAccounts(session.accounts);
  setActiveAccountId(session.activeAccountId);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<SessionAccountSummary[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProviderOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeAccount = useMemo(
    () =>
      accounts.find((account) => account.accountId === activeAccountId) || null,
    [accounts, activeAccountId],
  );

  const user = useMemo<User | null>(() => {
    if (!activeAccount || !activeAccount.isValid) {
      return null;
    }

    return {
      id: activeAccount.userId,
      email: activeAccount.email,
      displayName: activeAccount.displayName,
      accountId: activeAccount.accountId,
      avatarUrl: activeAccount.avatarUrl,
      isValid: activeAccount.isValid,
      invalidReason: activeAccount.invalidReason,
      providers: activeAccount.providers,
    };
  }, [activeAccount]);

  const loadProviders = async () => {
    const response = await apiClient.getAuthProviders();
    setProviders(response.providers);
  };

  const refreshSession = async () => {
    try {
      const session = await apiClient.getAuthSession();
      applySessionState(session, setAccounts, setActiveAccountId);
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to refresh session";
      setError(errorMessage);
      setAccounts([]);
      setActiveAccountId(null);
    }
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [providerResponse, sessionResponse] = await Promise.all([
          apiClient.getAuthProviders(),
          apiClient.getAuthSession(),
        ]);
        setProviders(providerResponse.providers);
        applySessionState(sessionResponse, setAccounts, setActiveAccountId);
      } catch (err: any) {
        const errorMessage =
          err?.detail || err?.message || "Failed to initialize authentication";
        setError(errorMessage);
        setAccounts([]);
        setActiveAccountId(null);
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrapAuth();
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      void refreshSession();
    };

    window.addEventListener(
      "auth:unauthorized",
      handleUnauthorized as EventListener,
    );
    return () => {
      window.removeEventListener(
        "auth:unauthorized",
        handleUnauthorized as EventListener,
      );
    };
  }, [accounts.length, activeAccountId]);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const session = await apiClient.login(email, password);
      applySessionState(session, setAccounts, setActiveAccountId);
      await loadProviders();
    } catch (err: any) {
      const errorMessage = err?.detail || err?.message || "Failed to sign in";
      setError(errorMessage);
      throw err;
    }
  };

  const register = async (
    email: string,
    password: string,
  ): Promise<RegistrationChallengeResponse> => {
    setError(null);
    try {
      return await apiClient.register(email, password);
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to start registration";
      setError(errorMessage);
      throw err;
    }
  };

  const verifyEmail = async (email: string, otp: string) => {
    setError(null);
    try {
      const session = await apiClient.verifyEmail(email, otp);
      applySessionState(session, setAccounts, setActiveAccountId);
      await loadProviders();
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to verify email";
      setError(errorMessage);
      throw err;
    }
  };

  const resendOtp = async (
    email: string,
  ): Promise<RegistrationChallengeResponse> => {
    setError(null);
    try {
      return await apiClient.resendOtp(email);
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to resend code";
      setError(errorMessage);
      throw err;
    }
  };

  const verifyOAuthLink = async (email: string, otp: string) => {
    setError(null);
    try {
      const session = await apiClient.verifyOAuthLink(email, otp);
      applySessionState(session, setAccounts, setActiveAccountId);
      await loadProviders();
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to verify linked provider";
      setError(errorMessage);
      throw err;
    }
  };

  const resendOAuthLink = async (
    email: string,
  ): Promise<RegistrationChallengeResponse> => {
    setError(null);
    try {
      return await apiClient.resendOAuthLink(email);
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to resend code";
      setError(errorMessage);
      throw err;
    }
  };

  const beginOAuthLogin = (
    provider: string,
    options?: { addAccount?: boolean },
  ) => {
    setError(null);
    const url = apiClient.getOAuthStartUrl(provider, {
      addAccount: options?.addAccount ?? accounts.length > 0,
      prompt: "select_account",
    });
    window.location.assign(url);
  };

  const switchAccount = async (accountId: string) => {
    setError(null);
    try {
      const session = await apiClient.switchAccount(accountId);
      applySessionState(session, setAccounts, setActiveAccountId);
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to switch account";
      setError(errorMessage);
      throw err;
    }
  };

  const removeAccount = async (accountId: string) => {
    setError(null);
    try {
      const session = await apiClient.removeAccount(accountId);
      applySessionState(session, setAccounts, setActiveAccountId);
    } catch (err: any) {
      const errorMessage =
        err?.detail || err?.message || "Failed to remove account";
      setError(errorMessage);
      throw err;
    }
  };

  const logoutAccount = async (accountId: string) => {
    await removeAccount(accountId);
  };

  const logoutCurrentAccount = async () => {
    if (!activeAccountId) {
      const missingAccountError = new Error("No active account selected");
      setError(missingAccountError.message);
      throw missingAccountError;
    }

    await removeAccount(activeAccountId);
  };

  const logoutAll = async () => {
    setError(null);
    try {
      const session = await apiClient.logoutAll();
      applySessionState(session, setAccounts, setActiveAccountId);
      await loadProviders();
    } catch (err: any) {
      const errorMessage = err?.detail || err?.message || "Failed to log out";
      setError(errorMessage);
      throw err;
    }
  };

  const logout = async (accountId?: string) => {
    if (accountId) {
      await logoutAccount(accountId);
      return;
    }
    await logoutAll();
  };

  const clearError = () => {
    setError(null);
  };

  const value: AuthContextType = {
    user,
    activeAccount,
    accounts,
    activeAccountId,
    providers,
    isAuthenticated: accounts.length > 0,
    hasValidActiveAccount: !!activeAccount?.isValid,
    isLoading,
    error,
    login,
    register,
    verifyEmail,
    resendOtp,
    verifyOAuthLink,
    resendOAuthLink,
    beginOAuthLogin,
    switchAccount,
    removeAccount,
    logoutAccount,
    logoutCurrentAccount,
    logout,
    logoutAll,
    refreshSession,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function withAuth<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  return function ProtectedComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          Loading...
        </div>
      );
    }

    if (!isAuthenticated) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          Please sign in
        </div>
      );
    }

    return <Component {...props} />;
  };
}
