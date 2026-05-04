import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { useAuth } from "../services/auth";
import {
  apiClient,
  type CurrentUserResponse,
  type RegistrationChallengeResponse,
} from "../services/api";
import {
  PasswordValidator,
  validatePassword,
} from "./PasswordValidator";
import { StatusToast } from "./ui/status-toast";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "./ui/input-otp";
import { GoogleIcon } from "./ui/provider-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type NoticeState = {
  tone: "success" | "error";
  message: string;
};

type ProviderActionDialogState = {
  mode: "connect" | "unlink";
  providerId: string;
  providerLabel: string;
};

type SettingsTab = "profile" | "security";

const EMPTY_PROFILE_FORM = {
  displayName: "",
};

const EMPTY_EMAIL_FORM = {
  newEmail: "",
  currentPassword: "",
};

const EMPTY_PASSWORD_FORM = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const EMPTY_DELETE_FORM = {
  confirmation: "",
  currentPassword: "",
};

const ELEVATED_INPUT_CLASS_NAME =
  "border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_24px_rgba(15,23,42,0.06)] hover:border-slate-300 focus-visible:border-slate-300 disabled:bg-slate-50 disabled:opacity-100";

function getUserInitial(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = displayName?.trim() || email?.trim() || "U";
  return source.charAt(0).toUpperCase();
}

function formatAccountDate(value: string): string {
  return format(new Date(value), "MMM d, yyyy");
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmailFormat(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function SettingsPage() {
  const {
    activeAccount,
    activeAccountId,
    hasValidActiveAccount,
    providers,
    refreshSession,
  } = useAuth();
  const [currentUser, setCurrentUser] = useState<CurrentUserResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [emailForm, setEmailForm] = useState(EMPTY_EMAIL_FORM);
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [deleteForm, setDeleteForm] = useState(EMPTY_DELETE_FORM);
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<SettingsTab>("profile");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [emailChangeChallenge, setEmailChangeChallenge] =
    useState<RegistrationChallengeResponse | null>(null);
  const [emailChangeOtp, setEmailChangeOtp] = useState("");
  const [emailValidationError, setEmailValidationError] = useState<
    string | null
  >(null);
  const [validatedEmailAddress, setValidatedEmailAddress] = useState<
    string | null
  >(null);
  const [isCheckingEmailAvailability, setIsCheckingEmailAvailability] =
    useState(false);
  const [isVerifyingEmailChange, setIsVerifyingEmailChange] = useState(false);
  const [isResendingEmailChange, setIsResendingEmailChange] = useState(false);
  const [
    emailChangeResendRemainingSeconds,
    setEmailChangeResendRemainingSeconds,
  ] = useState(0);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [providerActionDialog, setProviderActionDialog] =
    useState<ProviderActionDialogState | null>(null);
  const [providerActionPassword, setProviderActionPassword] = useState("");
  const [providerActionError, setProviderActionError] = useState<string | null>(
    null,
  );
  const [isSubmittingProviderAction, setIsSubmittingProviderAction] =
    useState(false);
  const emailValidationRequestId = useRef(0);
  const emailVerificationSectionRef = useRef<HTMLDivElement | null>(null);
  const closeNotice = useCallback(() => {
    setNotice(null);
  }, []);

  useEffect(() => {
    const loadCurrentUser = async () => {
      if (!hasValidActiveAccount) {
        setCurrentUser(null);
        setEmailChangeChallenge(null);
        setEmailChangeOtp("");
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const user = await apiClient.getCurrentUser();
        setCurrentUser(user);
        setProfileForm({ displayName: user.display_name || "" });
        setEmailForm({ newEmail: user.email, currentPassword: "" });
        setDeleteForm(EMPTY_DELETE_FORM);
        setEmailChangeChallenge(null);
        setEmailChangeOtp("");
        setEmailValidationError(null);
        setValidatedEmailAddress(null);
        setIsCheckingEmailAvailability(false);
      } catch (err: any) {
        setNotice({
          tone: "error",
          message:
            err?.detail || err?.message || "Failed to load account settings",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void loadCurrentUser();
  }, [activeAccountId, hasValidActiveAccount]);

  useEffect(() => {
    if (!currentUser) {
      setEmailValidationError(null);
      setValidatedEmailAddress(null);
      setIsCheckingEmailAvailability(false);
      return;
    }

    const normalizedNewEmail = normalizeEmailInput(emailForm.newEmail);
    const currentEmail = normalizeEmailInput(currentUser.email);

    if (!normalizedNewEmail) {
      setEmailValidationError(null);
      setValidatedEmailAddress(null);
      setIsCheckingEmailAvailability(false);
      return;
    }

    if (normalizedNewEmail === currentEmail) {
      setEmailValidationError(null);
      setValidatedEmailAddress(null);
      setIsCheckingEmailAvailability(false);
      return;
    }

    if (!isValidEmailFormat(normalizedNewEmail)) {
      setEmailValidationError("Enter a valid email address");
      setValidatedEmailAddress(null);
      setIsCheckingEmailAvailability(false);
      return;
    }

    const requestId = emailValidationRequestId.current + 1;
    emailValidationRequestId.current = requestId;

    const timeoutId = window.setTimeout(async () => {
      setIsCheckingEmailAvailability(true);

      try {
        await apiClient.validateCurrentUserEmailChange(normalizedNewEmail);
        if (emailValidationRequestId.current !== requestId) {
          return;
        }

        setEmailValidationError(null);
        setValidatedEmailAddress(normalizedNewEmail);
      } catch (err: any) {
        if (emailValidationRequestId.current !== requestId) {
          return;
        }

        setEmailValidationError(
          err?.detail || err?.message || "Failed to validate email",
        );
        setValidatedEmailAddress(null);
      } finally {
        if (emailValidationRequestId.current === requestId) {
          setIsCheckingEmailAvailability(false);
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentUser?.email, currentUser?.has_email_auth, emailForm.newEmail]);

  useEffect(() => {
    if (!emailChangeChallenge) {
      setEmailChangeResendRemainingSeconds(0);
      return;
    }

    const updateRemaining = () => {
      const seconds = Math.max(
        0,
        Math.ceil(
          (new Date(emailChangeChallenge.resendAvailableAt).getTime() -
            Date.now()) /
            1000,
        ),
      );
      setEmailChangeResendRemainingSeconds(seconds);
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [emailChangeChallenge]);

  useEffect(() => {
    if (!emailChangeChallenge) {
      return;
    }

    emailVerificationSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [emailChangeChallenge]);

  const clearEmailChangeChallenge = () => {
    setEmailChangeChallenge(null);
    setEmailChangeOtp("");
    setEmailChangeResendRemainingSeconds(0);
  };

  const handleEmailInputChange = (nextEmail: string) => {
    setEmailForm((current) => ({
      ...current,
      newEmail: nextEmail,
    }));

    if (
      emailChangeChallenge &&
      nextEmail.trim().toLowerCase() !==
        emailChangeChallenge.email.toLowerCase()
    ) {
      clearEmailChangeChallenge();
    }
  };

  const connectedProviders = activeAccount?.providers || [];
  const oauthProviderStates = useMemo(() => {
    const connectedProvidersByType = new Map(
      connectedProviders.map((provider) => [provider.type, provider]),
    );

    return providers
      .filter((provider) => provider.isConfigured)
      .map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        connection: connectedProvidersByType.get(provider.id) || null,
      }));
  }, [connectedProviders, providers]);
  const linkedOauthProviderCount = oauthProviderStates.filter(
    (provider) => provider.connection?.isLinked,
  ).length;
  const canEnableEmailPassword =
    Boolean(currentUser) &&
    !Boolean(currentUser?.has_email_auth) &&
    linkedOauthProviderCount > 0;
  const requiresCurrentPasswordForEmailChange = Boolean(
    currentUser?.has_email_auth,
  );
  const requiresProviderReauth = Boolean(currentUser?.has_email_auth);
  const normalizedNewEmail = normalizeEmailInput(emailForm.newEmail);
  const hasValidatedEmailChangeTarget =
    validatedEmailAddress === normalizedNewEmail;
  const canRequestEmailChangeCode =
    Boolean(currentUser) &&
    normalizedNewEmail.length > 0 &&
    (!requiresCurrentPasswordForEmailChange ||
      emailForm.currentPassword.trim().length > 0) &&
    !emailValidationError &&
    !isCheckingEmailAvailability &&
    hasValidatedEmailChangeTarget;
  const deleteConfirmationMatches =
    currentUser !== null &&
    deleteForm.confirmation.trim().toLowerCase() ===
      currentUser.email.toLowerCase();
  const canConfirmDeletion =
    deleteConfirmationMatches &&
    (!currentUser?.has_email_auth ||
      deleteForm.currentPassword.trim().length > 0);
  const passwordValidation = useMemo(
    () => validatePassword(passwordForm.newPassword, currentUser?.email),
    [currentUser?.email, passwordForm.newPassword],
  );
  const passwordConfirmationMatches =
    passwordForm.newPassword === passwordForm.confirmPassword;
  const canSubmitPasswordChange =
    passwordForm.newPassword.length > 0 &&
    passwordForm.confirmPassword.length > 0 &&
    passwordValidation.valid &&
    passwordConfirmationMatches &&
    (!currentUser?.has_email_auth ||
      passwordForm.currentPassword.trim().length > 0);

  const handleProfileSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const displayName = profileForm.displayName.trim();

    if (!displayName) {
      setNotice({ tone: "error", message: "Display name is required" });
      return;
    }

    try {
      setIsSavingProfile(true);
      setNotice(null);
      const updatedUser = await apiClient.updateCurrentUserProfile(displayName);
      setCurrentUser(updatedUser);
      await refreshSession();
      setNotice({ tone: "success", message: "Profile updated successfully" });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to update profile",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    if (normalizedNewEmail === normalizeEmailInput(currentUser.email)) {
      setNotice({
        tone: "error",
        message: "New email must be different from your current email",
      });
      return;
    }

    if (emailValidationError) {
      setNotice({
        tone: "error",
        message: emailValidationError,
      });
      return;
    }

    if (!hasValidatedEmailChangeTarget || isCheckingEmailAvailability) {
      setNotice({
        tone: "error",
        message: isCheckingEmailAvailability
          ? "Checking email availability. Please wait a moment."
          : "Enter an available email address before requesting a verification code.",
      });
      return;
    }

    try {
      setIsChangingEmail(true);
      setNotice(null);
      const challenge = await apiClient.startCurrentUserEmailChange(
        emailForm.newEmail.trim(),
        requiresCurrentPasswordForEmailChange
          ? emailForm.currentPassword
          : undefined,
      );
      setEmailChangeChallenge(challenge);
      setEmailChangeOtp("");
      setEmailForm({ newEmail: challenge.email, currentPassword: "" });
      setValidatedEmailAddress(normalizeEmailInput(challenge.email));
      setNotice({
        tone: "success",
        message: `Verification code sent to ${challenge.email}. Confirm it to update your email.`,
      });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to change email",
      });
    } finally {
      setIsChangingEmail(false);
    }
  };

  const handleVerifyEmailChange = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (emailChangeOtp.length !== 6) {
      setNotice({
        tone: "error",
        message: "Enter the 6-digit verification code.",
      });
      return;
    }

    try {
      setIsVerifyingEmailChange(true);
      setNotice(null);
      const updatedUser =
        await apiClient.verifyCurrentUserEmailChange(emailChangeOtp);
      setCurrentUser(updatedUser);
      setEmailForm({ newEmail: updatedUser.email, currentPassword: "" });
      setDeleteForm(EMPTY_DELETE_FORM);
      clearEmailChangeChallenge();
      await refreshSession();
      setNotice({ tone: "success", message: "Email updated successfully" });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to verify email",
      });
    } finally {
      setIsVerifyingEmailChange(false);
    }
  };

  const handleResendEmailChange = async () => {
    try {
      setIsResendingEmailChange(true);
      setNotice(null);
      const challenge = await apiClient.resendCurrentUserEmailChange();
      setEmailChangeChallenge(challenge);
      setEmailChangeOtp("");
      setEmailForm((current) => ({
        ...current,
        newEmail: challenge.email,
        currentPassword: "",
      }));
      setNotice({
        tone: "success",
        message: `A new verification code was sent to ${challenge.email}.`,
      });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to resend code",
      });
    } finally {
      setIsResendingEmailChange(false);
    }
  };

  const handlePasswordSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    if (
      currentUser.has_email_auth &&
      !passwordForm.currentPassword.trim()
    ) {
      setNotice({
        tone: "error",
        message: "Current password is required",
      });
      return;
    }

    if (!passwordValidation.valid) {
      setNotice({
        tone: "error",
        message: passwordValidation.errors[0],
      });
      return;
    }

    if (!passwordConfirmationMatches) {
      setNotice({
        tone: "error",
        message: "New password confirmation does not match",
      });
      return;
    }

    if (
      currentUser.has_email_auth &&
      passwordForm.currentPassword === passwordForm.newPassword
    ) {
      setNotice({
        tone: "error",
        message: "New password must be different from the current password",
      });
      return;
    }

    try {
      setIsChangingPassword(true);
      setNotice(null);
      const response = currentUser.has_email_auth
        ? await apiClient.changeCurrentUserPassword(
            passwordForm.currentPassword,
            passwordForm.newPassword,
          )
        : await apiClient.setCurrentUserPassword(passwordForm.newPassword);
      const updatedUser = await apiClient.getCurrentUser();
      setCurrentUser(updatedUser);
      await refreshSession();
      setPasswordForm(EMPTY_PASSWORD_FORM);
      setNotice({ tone: "success", message: response.message });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to change password",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!currentUser) {
      return;
    }

    try {
      setIsDeletingAccount(true);
      setNotice(null);
      await apiClient.deleteCurrentUserAccount(
        deleteForm.confirmation.trim(),
        currentUser.has_email_auth ? deleteForm.currentPassword : undefined,
      );
      setIsDeleteDialogOpen(false);
      await refreshSession();
      setNotice({ tone: "success", message: "Account deleted successfully" });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to delete account",
      });
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const openProviderActionDialog = (
    mode: ProviderActionDialogState["mode"],
    providerId: string,
    providerLabel: string,
  ) => {
    setProviderActionPassword("");
    setProviderActionError(null);
    setProviderActionDialog({ mode, providerId, providerLabel });
  };

  const handleProviderAction = async () => {
    if (!providerActionDialog) {
      return;
    }

    try {
      setIsSubmittingProviderAction(true);
      setProviderActionError(null);
      setNotice(null);

      if (providerActionDialog.mode === "connect") {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = apiClient.getOAuthProviderLinkStartUrl(
          providerActionDialog.providerId,
        );
        form.style.display = "none";

        if (requiresProviderReauth) {
          const passwordInput = document.createElement("input");
          passwordInput.type = "hidden";
          passwordInput.name = "current_password";
          passwordInput.value = providerActionPassword;
          form.appendChild(passwordInput);
        }

        document.body.appendChild(form);
        form.submit();
        form.remove();
        return;
      }

      await apiClient.unlinkOAuthProvider(
        providerActionDialog.providerId,
        requiresProviderReauth ? providerActionPassword : undefined,
      );
      await refreshSession();
      const updatedUser = await apiClient.getCurrentUser();
      setCurrentUser(updatedUser);
      setProviderActionDialog(null);
      setProviderActionPassword("");
      setNotice({
        tone: "success",
        message: `${providerActionDialog.providerLabel} disconnected successfully`,
      });
    } catch (err: any) {
      setProviderActionError(
        err?.detail || err?.message || "Failed to update connected provider",
      );
    } finally {
      setIsSubmittingProviderAction(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full p-6">
        <div className="flex h-full items-center justify-center rounded-3xl border border-border/50 bg-white shadow-sm">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading account settings...
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="h-full p-6">
        <div className="flex h-full items-center justify-center rounded-3xl border border-border/50 bg-white p-8 shadow-sm">
          <Alert className="max-w-xl border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No active account</AlertTitle>
            <AlertDescription>
              Connect or switch to a valid account to manage profile and
              security settings.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-full p-6">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-white shadow-sm">
          <div className="border-b border-border/50 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_48%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_44%),white] px-6 py-6 md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  Settings
                </h1>
                <p className="mt-2 max-w-3xl text-base text-muted-foreground">
                  Manage your profile, sign-in credentials, and account
                  lifecycle without leaving the workspace.
                </p>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-white/85 px-4 py-3 shadow-sm backdrop-blur">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-base font-semibold text-white">
                  {getUserInitial(currentUser.display_name, currentUser.email)}
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {currentUser.display_name || currentUser.email}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {currentUser.email}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8">
            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card className="border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle>Account</CardTitle>
                  <CardDescription>
                    Essential identity details and active sign-in methods.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-2xl border border-border/60 bg-slate-50 p-5">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-lg font-semibold text-white">
                        {getUserInitial(
                          currentUser.display_name,
                          currentUser.email,
                        )}
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-foreground">
                          {currentUser.display_name || currentUser.email}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {currentUser.email}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Member since
                    </p>
                    <p className="mt-2 text-base font-medium text-foreground">
                      {formatAccountDate(currentUser.created_at)}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      Connected Accounts
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-border/60 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                              <Mail className="h-4 w-4 text-slate-600" />
                              Email & Password
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {currentUser.has_email_auth
                                ? currentUser.email
                                : "Password sign-in is not enabled for this account yet."}
                            </p>
                          </div>
                          <Badge
                            variant={
                              currentUser.has_email_auth
                                ? "secondary"
                                : "outline"
                            }
                            className={
                              currentUser.has_email_auth
                                ? "bg-secondary/70 text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {currentUser.has_email_auth
                              ? "Enabled"
                              : "Not enabled"}
                          </Badge>
                        </div>
                        {!currentUser.has_email_auth &&
                          canEnableEmailPassword && (
                            <div className="mt-4 flex justify-end">
                              <Button
                                type="button"
                                className="bg-slate-900 text-white hover:bg-slate-800"
                                onClick={() => setActiveSettingsTab("security")}
                              >
                                Set Password
                              </Button>
                            </div>
                          )}
                      </div>

                      {oauthProviderStates.map((provider) => {
                        const connection = provider.connection;
                        const isConnected = connection?.isLinked === true;
                        const hasProviderEmailMismatch =
                          isConnected &&
                          Boolean(connection?.providerEmail) &&
                          Boolean(currentUser.email) &&
                          connection?.providerEmail?.toLowerCase() !==
                            currentUser.email.toLowerCase();
                        const canDisconnect =
                          isConnected &&
                          (currentUser.has_email_auth ||
                            linkedOauthProviderCount > 1);

                        return (
                          <div
                            key={provider.id}
                            className="rounded-2xl border border-border/60 px-4 py-4"
                          >
                            <div className="flex flex-col gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                  {provider.id === "google" ? (
                                    <GoogleIcon className="h-4 w-4" />
                                  ) : (
                                    <KeyRound className="h-4 w-4" />
                                  )}
                                  {provider.displayName}
                                </div>
                                <p className="mt-2 break-all text-sm text-muted-foreground">
                                  {isConnected
                                    ? connection?.providerEmail ||
                                      "Connected without provider email"
                                    : "Not connected"}
                                </p>
                                {hasProviderEmailMismatch && (
                                  <p className="mt-2 text-xs text-slate-600">
                                    This {provider.displayName} account is
                                    linked with {connection?.providerEmail},
                                    while your primary account email is{" "}
                                    {currentUser.email}.
                                  </p>
                                )}
                                {isConnected && !canDisconnect && (
                                  <p className="mt-2 text-xs text-amber-700">
                                    Connect another login method before
                                    disconnecting this provider.
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant={
                                    isConnected ? "secondary" : "outline"
                                  }
                                  className={
                                    isConnected
                                      ? "bg-secondary/70 text-foreground"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {isConnected ? "Connected" : "Not connected"}
                                </Badge>
                                <Button
                                  type="button"
                                  variant={isConnected ? "outline" : "default"}
                                  className={
                                    isConnected
                                      ? "shrink-0"
                                      : "shrink-0 bg-slate-900 text-white hover:bg-slate-800"
                                  }
                                  disabled={isConnected && !canDisconnect}
                                  onClick={() =>
                                    openProviderActionDialog(
                                      isConnected ? "unlink" : "connect",
                                      provider.id,
                                      provider.displayName,
                                    )
                                  }
                                >
                                  {isConnected ? "Disconnect" : "Connect"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Tabs
                value={activeSettingsTab}
                onValueChange={(value: string) =>
                  setActiveSettingsTab(value as SettingsTab)
                }
                className="min-w-0"
              >
                <TabsList className="w-full justify-start sm:w-auto">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="mt-4 space-y-6">
                  <Card className="border-border/60 shadow-sm">
                    <CardHeader>
                      <CardTitle>Profile information</CardTitle>
                      <CardDescription>
                        Update the name shown across the app and in the sidebar
                        account switcher.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="space-y-5"
                        onSubmit={handleProfileSubmit}
                      >
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">
                            Display name
                          </label>
                          <Input
                            value={profileForm.displayName}
                            onChange={(event) =>
                              setProfileForm({
                                displayName: event.target.value,
                              })
                            }
                            disabled={isSavingProfile}
                            placeholder="How your name should appear"
                            className={ELEVATED_INPUT_CLASS_NAME}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">
                            Account email
                          </label>
                          <Input
                            value={currentUser.email}
                            disabled
                            className={ELEVATED_INPUT_CLASS_NAME}
                          />
                        </div>

                        <div className="flex justify-end">
                          <Button type="submit" disabled={isSavingProfile}>
                            {isSavingProfile ? "Saving..." : "Save profile"}
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="security" className="mt-4 space-y-6">
                  <Card className="border-border/60 shadow-sm">
                    <CardHeader>
                      <CardTitle>Change email</CardTitle>
                      <CardDescription>
                        Verify the new address with a one-time code before we
                        update your primary account email.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <form className="space-y-5" onSubmit={handleEmailSubmit}>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">
                            New email
                          </label>
                          <Input
                            type="email"
                            value={emailForm.newEmail}
                            onChange={(event) =>
                              handleEmailInputChange(event.target.value)
                            }
                            disabled={isChangingEmail}
                            className={ELEVATED_INPUT_CLASS_NAME}
                          />
                          {isCheckingEmailAvailability ? (
                            <p className="text-xs text-muted-foreground">
                              Checking email availability...
                            </p>
                          ) : emailValidationError ? (
                            <p className="text-xs text-red-600">
                              {emailValidationError}
                            </p>
                          ) : hasValidatedEmailChangeTarget ? (
                            <p className="text-xs text-emerald-700">
                              Email is available. You can send a verification
                              code.
                            </p>
                          ) : null}
                        </div>

                        {currentUser.has_email_auth && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                              Current password
                            </label>
                            <Input
                              type="password"
                              value={emailForm.currentPassword}
                              onChange={(event) =>
                                setEmailForm((current) => ({
                                  ...current,
                                  currentPassword: event.target.value,
                                }))
                              }
                              disabled={isChangingEmail}
                              className={ELEVATED_INPUT_CLASS_NAME}
                            />
                          </div>
                        )}

                        <Alert className="border-sky-200 bg-sky-50 text-sky-950">
                          <ShieldCheck className="h-4 w-4" />
                          <AlertTitle>
                            Connected login methods stay linked
                          </AlertTitle>
                          <AlertDescription>
                            Changing your email updates the account email used
                            for password sign-in, while connected providers stay
                            linked to this account.
                          </AlertDescription>
                        </Alert>

                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            disabled={
                              isChangingEmail || !canRequestEmailChangeCode
                            }
                          >
                            {isChangingEmail
                              ? "Sending..."
                              : isCheckingEmailAvailability
                                ? "Checking..."
                                : emailChangeChallenge
                                  ? "Send new code"
                                  : "Send verification code"}
                          </Button>
                        </div>
                      </form>

                      {emailChangeChallenge && (
                        <div
                          ref={emailVerificationSectionRef}
                          className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5"
                        >
                          <div className="space-y-4">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-emerald-950">
                                Verify new email
                              </p>
                              <p className="text-sm text-emerald-900">
                                {emailChangeChallenge.message}
                              </p>
                              <p className="text-sm text-emerald-900">
                                We sent a 6-digit code to{" "}
                                {emailChangeChallenge.email}.
                              </p>
                            </div>

                            <form
                              className="space-y-4"
                              onSubmit={handleVerifyEmailChange}
                            >
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">
                                  Verification code
                                </label>
                                <InputOTP
                                  value={emailChangeOtp}
                                  onChange={setEmailChangeOtp}
                                  maxLength={6}
                                  autoFocus
                                  disabled={isVerifyingEmailChange}
                                >
                                  <InputOTPGroup>
                                    <InputOTPSlot index={0} />
                                    <InputOTPSlot index={1} />
                                    <InputOTPSlot index={2} />
                                  </InputOTPGroup>
                                  <InputOTPSeparator />
                                  <InputOTPGroup>
                                    <InputOTPSlot index={3} />
                                    <InputOTPSlot index={4} />
                                    <InputOTPSlot index={5} />
                                  </InputOTPGroup>
                                </InputOTP>
                              </div>

                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <p className="text-sm text-emerald-900/80">
                                  {emailChangeResendRemainingSeconds > 0
                                    ? `Resend available in ${formatCountdown(emailChangeResendRemainingSeconds)}`
                                    : "Didn't receive the code? You can resend it now."}
                                </p>

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={clearEmailChangeChallenge}
                                    disabled={
                                      isVerifyingEmailChange ||
                                      isResendingEmailChange
                                    }
                                  >
                                    Use different email
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                      void handleResendEmailChange()
                                    }
                                    disabled={
                                      emailChangeResendRemainingSeconds > 0 ||
                                      isResendingEmailChange ||
                                      isVerifyingEmailChange
                                    }
                                  >
                                    {isResendingEmailChange
                                      ? "Resending..."
                                      : "Resend code"}
                                  </Button>
                                  <Button
                                    type="submit"
                                    disabled={
                                      emailChangeOtp.length !== 6 ||
                                      isVerifyingEmailChange
                                    }
                                  >
                                    {isVerifyingEmailChange
                                      ? "Verifying..."
                                      : "Verify and update email"}
                                  </Button>
                                </div>
                              </div>
                            </form>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-border/60 shadow-sm">
                    <CardHeader>
                      <CardTitle>
                        {currentUser.has_email_auth
                          ? "Change password"
                          : "Set password"}
                      </CardTitle>
                      <CardDescription>
                        {currentUser.has_email_auth
                          ? "Use at least 12 characters with uppercase, lowercase, a number, and a symbol."
                          : "Enable email/password sign-in for this same account without creating a second user."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="space-y-5"
                        onSubmit={handlePasswordSubmit}
                      >
                        {currentUser.has_email_auth && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                              Current password
                            </label>
                            <Input
                              type="password"
                              value={passwordForm.currentPassword}
                              onChange={(event) =>
                                setPasswordForm((current) => ({
                                  ...current,
                                  currentPassword: event.target.value,
                                }))
                              }
                              disabled={isChangingPassword}
                              className={ELEVATED_INPUT_CLASS_NAME}
                            />
                          </div>
                        )}

                        <div className="grid gap-5 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                              New password
                            </label>
                            <Input
                              type="password"
                              value={passwordForm.newPassword}
                              onChange={(event) =>
                                setPasswordForm((current) => ({
                                  ...current,
                                  newPassword: event.target.value,
                                }))
                              }
                              disabled={isChangingPassword}
                              className={ELEVATED_INPUT_CLASS_NAME}
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                              Confirm new password
                            </label>
                            <Input
                              type="password"
                              value={passwordForm.confirmPassword}
                              onChange={(event) =>
                                setPasswordForm((current) => ({
                                  ...current,
                                  confirmPassword: event.target.value,
                                }))
                              }
                              disabled={isChangingPassword}
                              className={ELEVATED_INPUT_CLASS_NAME}
                            />
                          </div>
                        </div>

                        {passwordForm.confirmPassword.length > 0 &&
                          !passwordConfirmationMatches && (
                            <p className="text-sm text-red-600">
                              New password confirmation does not match.
                            </p>
                          )}

                        <PasswordValidator validation={passwordValidation} />

                        {!currentUser.has_email_auth && (
                          <Alert className="border-sky-200 bg-sky-50 text-sky-950">
                            <KeyRound className="h-4 w-4" />
                            <AlertTitle>
                              Email & Password will stay on this account
                            </AlertTitle>
                            <AlertDescription>
                              Setting a password enables email/password login
                              for {currentUser.email} without disconnecting your
                              existing providers.
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            disabled={
                              isChangingPassword || !canSubmitPasswordChange
                            }
                          >
                            {isChangingPassword
                              ? currentUser.has_email_auth
                                ? "Updating..."
                                : "Saving..."
                              : currentUser.has_email_auth
                                ? "Update password"
                                : "Set password"}
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>

                  <Card className="border-red-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-red-700">
                        Delete Account
                      </CardTitle>
                      <CardDescription>
                        Permanently delete this account, including its linked
                        projects and saved session access.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <Alert className="border-red-200 bg-red-50 text-red-950">
                        <Trash2 className="h-4 w-4" />
                        <AlertTitle>Permanent action</AlertTitle>
                        <AlertDescription>
                          Type your current email address to confirm deletion.
                          This action cannot be undone.
                        </AlertDescription>
                      </Alert>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Confirm email address
                        </label>
                        <Input
                          value={deleteForm.confirmation}
                          onChange={(event) =>
                            setDeleteForm((current) => ({
                              ...current,
                              confirmation: event.target.value,
                            }))
                          }
                          placeholder={currentUser.email}
                          disabled={isDeletingAccount}
                          className={ELEVATED_INPUT_CLASS_NAME}
                        />
                      </div>

                      {currentUser.has_email_auth && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">
                            Current password
                          </label>
                          <Input
                            type="password"
                            value={deleteForm.currentPassword}
                            onChange={(event) =>
                              setDeleteForm((current) => ({
                                ...current,
                                currentPassword: event.target.value,
                              }))
                            }
                            disabled={isDeletingAccount}
                            className={ELEVATED_INPUT_CLASS_NAME}
                          />
                        </div>
                      )}

                      <div className="flex justify-end">
                        <Button
                          type="button"
                          className="bg-red-600 text-white hover:bg-red-700"
                          disabled={!canConfirmDeletion || isDeletingAccount}
                          onClick={() => setIsDeleteDialogOpen(true)}
                        >
                          Delete account
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>

      {notice && (
        <StatusToast
          tone={notice.tone}
          message={notice.message}
          onClose={closeNotice}
        />
      )}

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!isDeletingAccount) {
            setIsDeleteDialogOpen(open);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This permanently removes the current account and disconnects it
              from every active browser session.
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-red-200 bg-red-50 text-red-950">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This cannot be undone</AlertTitle>
            <AlertDescription>
              All projects, saved generations, and account access tied to this
              user will be deleted.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeletingAccount}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => void handleDeleteAccount()}
              disabled={isDeletingAccount}
            >
              {isDeletingAccount ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={providerActionDialog !== null}
        onOpenChange={(open: boolean) => {
          if (!open && !isSubmittingProviderAction) {
            setProviderActionDialog(null);
            setProviderActionPassword("");
            setProviderActionError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {providerActionDialog?.mode === "unlink"
                ? `Disconnect ${providerActionDialog.providerLabel}`
                : `Connect ${providerActionDialog?.providerLabel}`}
            </DialogTitle>
            <DialogDescription>
              {providerActionDialog?.mode === "unlink"
                ? "Disconnect this provider from your account."
                : "Start the secure OAuth flow to connect this provider to your current account."}
            </DialogDescription>
          </DialogHeader>

          {providerActionError && (
            <Alert className="border-red-200 bg-red-50 text-red-950">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{providerActionError}</AlertDescription>
            </Alert>
          )}

          {requiresProviderReauth && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Current password
              </label>
              <Input
                type="password"
                value={providerActionPassword}
                onChange={(event) =>
                  setProviderActionPassword(event.target.value)
                }
                disabled={isSubmittingProviderAction}
                className={ELEVATED_INPUT_CLASS_NAME}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setProviderActionDialog(null);
                setProviderActionPassword("");
                setProviderActionError(null);
              }}
              disabled={isSubmittingProviderAction}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className={
                providerActionDialog?.mode === "unlink"
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-slate-900 text-white hover:bg-slate-800"
              }
              onClick={() => void handleProviderAction()}
              disabled={
                isSubmittingProviderAction ||
                (requiresProviderReauth &&
                  providerActionPassword.trim().length === 0)
              }
            >
              {isSubmittingProviderAction
                ? providerActionDialog?.mode === "unlink"
                  ? "Disconnecting..."
                  : "Redirecting..."
                : providerActionDialog?.mode === "unlink"
                  ? "Disconnect provider"
                  : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
