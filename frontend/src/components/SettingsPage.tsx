import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Github,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { useAuth } from "../services/auth";
import { apiClient, type CurrentUserResponse } from "../services/api";
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
import { GoogleIcon } from "./ui/provider-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

type NoticeState = {
  tone: "success" | "error";
  message: string;
};

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

export function SettingsPage() {
  const {
    activeAccount,
    activeAccountId,
    hasValidActiveAccount,
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
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    const loadCurrentUser = async () => {
      if (!hasValidActiveAccount) {
        setCurrentUser(null);
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

  const connectedProviders = activeAccount?.providers || [];
  const deleteConfirmationMatches =
    currentUser !== null &&
    deleteForm.confirmation.trim().toLowerCase() ===
      currentUser.email.toLowerCase();
  const canConfirmDeletion =
    deleteConfirmationMatches &&
    (!currentUser?.has_email_auth ||
      deleteForm.currentPassword.trim().length > 0);

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

    if (!currentUser?.has_email_auth) {
      setNotice({
        tone: "error",
        message: "Email changes are only available for email/password accounts",
      });
      return;
    }

    try {
      setIsChangingEmail(true);
      setNotice(null);
      const updatedUser = await apiClient.changeCurrentUserEmail(
        emailForm.newEmail.trim(),
        emailForm.currentPassword,
      );
      setCurrentUser(updatedUser);
      setEmailForm({ newEmail: updatedUser.email, currentPassword: "" });
      setDeleteForm(EMPTY_DELETE_FORM);
      await refreshSession();
      setNotice({ tone: "success", message: "Email updated successfully" });
    } catch (err: any) {
      setNotice({
        tone: "error",
        message: err?.detail || err?.message || "Failed to change email",
      });
    } finally {
      setIsChangingEmail(false);
    }
  };

  const handlePasswordSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setNotice({
        tone: "error",
        message: "New password confirmation does not match",
      });
      return;
    }

    try {
      setIsChangingPassword(true);
      setNotice(null);
      const response = await apiClient.changeCurrentUserPassword(
        passwordForm.currentPassword,
        passwordForm.newPassword,
      );
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
            {notice && (
              <Alert
                className={
                  notice.tone === "success"
                    ? "mb-6 border-green-200 bg-green-50 text-green-950"
                    : "mb-6 border-red-200 bg-red-50 text-red-950"
                }
              >
                {notice.tone === "success" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {notice.tone === "success" ? "Updated" : "Action failed"}
                </AlertTitle>
                <AlertDescription>{notice.message}</AlertDescription>
              </Alert>
            )}

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
                      Sign-in methods
                    </div>
                    {connectedProviders.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {connectedProviders.map((provider) => (
                          <Badge
                            key={provider.type}
                            variant="secondary"
                            className={
                              provider.isValid
                                ? "gap-2 rounded-full bg-secondary/70 px-3 py-1 text-foreground"
                                : "gap-2 rounded-full bg-red-100 px-3 py-1 text-red-700"
                            }
                          >
                            {provider.type === "google" ? (
                              <GoogleIcon className="h-3.5 w-3.5" />
                            ) : provider.type === "github" ? (
                              <Github className="h-3.5 w-3.5" />
                            ) : (
                              <Mail className="h-3.5 w-3.5" />
                            )}
                            {provider.label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                        No connected sign-in methods are available for this
                        account.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Tabs defaultValue="profile" className="min-w-0">
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
                  {currentUser.has_email_auth ? (
                    <>
                      <Card className="border-border/60 shadow-sm">
                        <CardHeader>
                          <CardTitle>Change email</CardTitle>
                          <CardDescription>
                            Update the email tied to your password-based
                            sign-in.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <form
                            className="space-y-5"
                            onSubmit={handleEmailSubmit}
                          >
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-foreground">
                                New email
                              </label>
                              <Input
                                type="email"
                                value={emailForm.newEmail}
                                onChange={(event) =>
                                  setEmailForm((current) => ({
                                    ...current,
                                    newEmail: event.target.value,
                                  }))
                                }
                                disabled={isChangingEmail}
                                className={ELEVATED_INPUT_CLASS_NAME}
                              />
                            </div>

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

                            <div className="flex justify-end">
                              <Button type="submit" disabled={isChangingEmail}>
                                {isChangingEmail
                                  ? "Updating..."
                                  : "Update email"}
                              </Button>
                            </div>
                          </form>
                        </CardContent>
                      </Card>

                      <Card className="border-border/60 shadow-sm">
                        <CardHeader>
                          <CardTitle>Change password</CardTitle>
                          <CardDescription>
                            Use a strong password with at least 8 characters.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <form
                            className="space-y-5"
                            onSubmit={handlePasswordSubmit}
                          >
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

                            <div className="flex justify-end">
                              <Button
                                type="submit"
                                disabled={isChangingPassword}
                              >
                                {isChangingPassword
                                  ? "Updating..."
                                  : "Update password"}
                              </Button>
                            </div>
                          </form>
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    <Alert className="border-sky-200 bg-sky-50 text-sky-950">
                      <KeyRound className="h-4 w-4" />
                      <AlertTitle>Password settings unavailable</AlertTitle>
                      <AlertDescription>
                        This account currently signs in through connected
                        providers only, so email and password changes do not
                        apply.
                      </AlertDescription>
                    </Alert>
                  )}

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
    </>
  );
}
