import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Database,
  FolderKanban,
  Github,
  Globe2,
  History,
  KeyRound,
  LogOut,
  Mail,
  Mic2,
  Settings,
} from "lucide-react";

import resonatorLogo from "../assets/resonator-logo.svg";
import resonatorWordmark from "../assets/resonator-wordmark.svg";
import type {
  ConnectedProviderSummary,
  SessionAccountSummary,
} from "../services/api";
import { useAuth } from "../services/auth";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { cn } from "./ui/utils";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

type PendingLogoutAction =
  | { kind: "account"; account: SessionAccountSummary }
  | { kind: "current"; account: SessionAccountSummary | null }
  | { kind: "all" };

function buildInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getProviderIcon(provider: string) {
  switch (provider) {
    case "github":
      return Github;
    case "google":
      return Globe2;
    case "email":
      return Mail;
    default:
      return KeyRound;
  }
}

function getProviderBadgeClasses(provider: string) {
  switch (provider) {
    case "github":
      return "bg-slate-900 text-white";
    case "google":
      return "bg-sky-100 text-sky-700";
    case "email":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

function getPrimaryProvider(
  providers: ConnectedProviderSummary[],
): ConnectedProviderSummary | null {
  return (
    providers.find((provider) => provider.isInSession) || providers[0] || null
  );
}

function getAccountLabel(account: SessionAccountSummary | null) {
  if (!account) {
    return "";
  }

  return account.displayName || account.email || "Connected user";
}

function getProviderSummary(account: SessionAccountSummary | null) {
  if (!account || account.providers.length === 0) {
    return "No connected providers";
  }

  return account.providers.map((provider) => provider.label).join(" · ");
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingLogoutAction, setPendingLogoutAction] =
    useState<PendingLogoutAction | null>(null);
  const [isProcessingLogout, setIsProcessingLogout] = useState(false);
  const [logoutDialogError, setLogoutDialogError] = useState<string | null>(
    null,
  );
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [emailFormError, setEmailFormError] = useState<string | null>(null);
  const [isAddingEmailAccount, setIsAddingEmailAccount] = useState(false);
  const [emailCredentials, setEmailCredentials] = useState({
    email: "",
    password: "",
  });
  const {
    clearError,
    user,
    accounts,
    activeAccountId,
    activeAccount,
    providers,
    error,
    hasValidActiveAccount,
    beginOAuthLogin,
    login,
    switchAccount,
    logoutAccount,
    logoutCurrentAccount,
    logoutAll,
  } = useAuth();

  const handleNavigationClick = (pageId: string) => {
    onPageChange(pageId);
  };

  const userName = useMemo(() => {
    if (user?.displayName) {
      return user.displayName;
    }

    if (user?.email) {
      const localPart = user.email.split("@")[0] || "User";
      return localPart
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    if (activeAccount?.displayName) {
      return activeAccount.displayName;
    }

    return "Signed-in Users";
  }, [activeAccount?.displayName, user?.displayName, user?.email]);

  const userInitials = useMemo(() => {
    const source =
      userName || user?.email || getProviderSummary(activeAccount) || "AU";
    return buildInitials(source);
  }, [activeAccount, user?.email, userName]);

  const configuredProviders = providers.filter(
    (provider) => provider.isConfigured,
  );
  const currentAccountLabel =
    getAccountLabel(activeAccount) || "the active user";

  const openLogoutDialog = (action: PendingLogoutAction) => {
    clearError();
    setLogoutDialogError(null);
    setPendingLogoutAction(action);
  };

  const closeLogoutDialog = () => {
    setPendingLogoutAction(null);
    setLogoutDialogError(null);
  };

  const handleConfirmLogout = async () => {
    if (!pendingLogoutAction) {
      return;
    }

    setIsProcessingLogout(true);
    setLogoutDialogError(null);

    try {
      if (pendingLogoutAction.kind === "account") {
        await logoutAccount(pendingLogoutAction.account.accountId);
      } else if (pendingLogoutAction.kind === "current") {
        await logoutCurrentAccount();
      } else {
        await logoutAll();
      }
      closeLogoutDialog();
    } catch (err: any) {
      setLogoutDialogError(
        err?.detail || err?.message || "Failed to log out user",
      );
    } finally {
      setIsProcessingLogout(false);
    }
  };

  const handleOpenEmailDialog = () => {
    clearError();
    setEmailFormError(null);
    setIsEmailDialogOpen(true);
  };

  const handleEmailDialogChange = (
    field: "email" | "password",
    value: string,
  ) => {
    setEmailCredentials((current) => ({
      ...current,
      [field]: value,
    }));
    if (emailFormError) {
      setEmailFormError(null);
    }
  };

  const handleAddEmailAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearError();
    setEmailFormError(null);
    setIsAddingEmailAccount(true);

    try {
      await login(emailCredentials.email, emailCredentials.password);
      setIsEmailDialogOpen(false);
      setEmailCredentials({ email: "", password: "" });
    } catch (err: any) {
      setEmailFormError(
        err?.detail || err?.message || "Failed to add email account",
      );
    } finally {
      setIsAddingEmailAccount(false);
    }
  };

  const logoutDialogTitle = useMemo(() => {
    if (!pendingLogoutAction) {
      return "";
    }

    if (pendingLogoutAction.kind === "account") {
      return `Log out ${getAccountLabel(pendingLogoutAction.account)}?`;
    }

    if (pendingLogoutAction.kind === "current") {
      return `Log out ${currentAccountLabel}?`;
    }

    return "Log out all users?";
  }, [currentAccountLabel, pendingLogoutAction]);

  const logoutDialogDescription = useMemo(() => {
    if (!pendingLogoutAction) {
      return "";
    }

    if (pendingLogoutAction.kind === "account") {
      return "This removes only the selected user from the current browser session. Other signed-in users stay available.";
    }

    if (pendingLogoutAction.kind === "current") {
      return "The active user will be removed from this browser session. If other signed-in users remain, one of them becomes active automatically.";
    }

    return "This removes every signed-in user from the current browser session and clears the session cookie.";
  }, [pendingLogoutAction]);

  const navigationItems = [
    {
      id: "studio",
      name: "Kokoro Studio",
      icon: Mic2,
      description: "Text-to-speech generation",
    },
    {
      id: "projects",
      name: "Projects",
      icon: FolderKanban,
      description: "Manage TTS projects",
    },
    {
      id: "history",
      name: "History",
      icon: History,
      description: "Generation history",
    },
    {
      id: "storage",
      name: "Remote Storage",
      icon: Database,
      description: "Cloud database & files",
    },
    {
      id: "settings",
      name: "Settings",
      icon: Settings,
      description: "System & API preferences",
    },
  ];

  return (
    <div className="ml-6 my-6">
      <div
        className={cn(
          "flex h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-3xl border border-sidebar-border/20 bg-gradient-to-b from-sidebar via-sidebar to-sidebar-accent shadow-2xl transition-all duration-300 ease-in-out",
          isExpanded ? "w-72" : "w-20",
        )}
      >
        <div
          className={cn(
            "relative border-b border-sidebar-border/20",
            isExpanded ? "px-5 py-5" : "px-4 py-5",
          )}
        >
          <div
            className={cn(
              "flex items-center",
              isExpanded ? "gap-3" : "justify-center",
            )}
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.25rem] bg-white shadow-lg">
              <img
                src={resonatorLogo}
                alt="Resonator logo"
                className="h-10 w-10"
              />
            </div>
            {isExpanded && (
              <div className="min-w-0">
                <img
                  src={resonatorWordmark}
                  alt="Resonator"
                  className="h-9 w-auto max-w-[10.5rem]"
                />
                <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-white/70">
                  AI Voice Generator
                </p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div
            className={cn(
              "mb-5 flex",
              isExpanded ? "justify-end" : "justify-center",
            )}
          >
            <button
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full border border-sidebar-border/30 bg-sidebar-accent/60 text-sidebar-foreground transition-all duration-200 hover:scale-110 hover:bg-sidebar-accent",
                isExpanded && "w-12",
              )}
              aria-label={
                isExpanded ? "Collapse navigation" : "Expand navigation"
              }
              title={isExpanded ? "Collapse navigation" : "Expand navigation"}
            >
              {isExpanded ? (
                <ChevronLeft className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </button>
          </div>

          <div className="space-y-4">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;

              return (
                <div key={item.id} className="group relative">
                  <button
                    onClick={() => handleNavigationClick(item.id)}
                    className={cn(
                      "relative flex items-center overflow-hidden transition-all duration-300 hover:scale-110 hover:shadow-lg",
                      isExpanded
                        ? "w-full justify-start rounded-xl px-4 py-3"
                        : "mx-auto h-12 w-12 justify-center rounded-full",
                      isActive
                        ? "scale-105 bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 shadow-lg shadow-sidebar-primary/30"
                        : "bg-gradient-to-br from-sidebar-accent to-sidebar-accent/80 hover:from-sidebar-primary/80 hover:to-sidebar-primary/60",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5 shrink-0 transition-colors duration-300",
                        isActive
                          ? "text-sidebar-primary-foreground"
                          : "text-sidebar-accent-foreground group-hover:text-sidebar-primary-foreground",
                      )}
                    />

                    {isExpanded && (
                      <div className="ml-3 overflow-hidden">
                        <div
                          className={cn(
                            "whitespace-nowrap text-sm font-medium transition-colors duration-300",
                            isActive
                              ? "text-sidebar-primary-foreground"
                              : "text-sidebar-accent-foreground group-hover:text-sidebar-primary-foreground",
                          )}
                        >
                          {item.name}
                        </div>
                        {isActive && (
                          <div className="mt-0.5 whitespace-nowrap text-xs text-sidebar-primary-foreground/70">
                            {item.description}
                          </div>
                        )}
                      </div>
                    )}

                    {isActive && !isExpanded && (
                      <>
                        <div className="absolute inset-0 animate-pulse rounded-full bg-sidebar-primary opacity-20" />
                        <div className="absolute -right-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-l-full bg-sidebar-primary" />
                      </>
                    )}

                    {isActive && isExpanded && (
                      <div className="absolute right-2 top-1/2 h-2 w-2 -translate-y-1/2 animate-pulse rounded-full bg-sidebar-primary-foreground" />
                    )}
                  </button>

                  {!isExpanded && (
                    <div className="pointer-events-none absolute left-full ml-4 translate-x-2 rounded-xl bg-gradient-to-br from-sidebar-primary to-sidebar-primary/90 px-3 py-2 whitespace-nowrap text-sidebar-primary-foreground opacity-0 shadow-lg transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 z-50">
                      <div className="text-sm font-medium">{item.name}</div>
                      <div className="mt-1 text-xs opacity-75">
                        {item.description}
                      </div>
                      <div className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1 -translate-y-1/2 rotate-45 bg-sidebar-primary" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-sidebar-border/30 p-4">
          <DropdownMenu>
            <div className="relative group">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center rounded-2xl bg-sidebar-accent/60 transition-all duration-300 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/60",
                    isExpanded ? "gap-3 px-3 py-3" : "justify-center px-2 py-3",
                  )}
                  aria-label="Open account menu"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 text-lg font-semibold text-sidebar-primary-foreground shadow-lg">
                    {userInitials || "AU"}
                  </div>

                  {isExpanded && (
                    <>
                      <div className="min-w-0 flex-1 overflow-hidden text-left">
                        <p className="truncate text-sm font-semibold text-sidebar-foreground">
                          {userName}
                        </p>
                        <p className="mt-1 truncate text-xs text-sidebar-foreground/70">
                          {user?.email ||
                            activeAccount?.email ||
                            "No active user"}
                        </p>
                      </div>
                      <ChevronsUpDown className="h-4 w-4 text-sidebar-foreground/70" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align={isExpanded ? "start" : "center"}
                className="w-80 rounded-2xl p-2"
                side={isExpanded ? "top" : "right"}
              >
                <DropdownMenuLabel className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {userName}
                      </div>
                      <div className="mt-1 truncate text-xs font-normal text-muted-foreground">
                        {user?.email ||
                          activeAccount?.email ||
                          "No active user selected"}
                      </div>
                    </div>
                    {!hasValidActiveAccount && accounts.length > 0 && (
                      <Badge variant="destructive" className="shrink-0">
                        Reconnect
                      </Badge>
                    )}
                  </div>
                </DropdownMenuLabel>

                <div className="max-h-72 space-y-2 overflow-y-auto px-1 py-2">
                  {accounts.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                      No users are connected in this browser session yet.
                    </div>
                  )}

                  {accounts.map((account) => {
                    const accountLabel = getAccountLabel(account);
                    const accountInitials = buildInitials(
                      accountLabel || getProviderSummary(account),
                    );
                    const isActive = account.accountId === activeAccountId;
                    const primaryProvider = getPrimaryProvider(
                      account.providers,
                    );
                    const ProviderIcon = getProviderIcon(
                      primaryProvider?.type || "email",
                    );

                    return (
                      <div
                        key={account.accountId}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border px-3 py-3",
                          isActive
                            ? "border-sky-200 bg-sky-50"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="relative shrink-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                              {accountInitials || "AU"}
                            </div>
                            <div
                              className={cn(
                                "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white",
                                getProviderBadgeClasses(
                                  primaryProvider?.type || "email",
                                ),
                              )}
                            >
                              <ProviderIcon className="h-3 w-3" />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {accountLabel}
                              </p>
                              {isActive && (
                                <Badge variant="secondary" className="shrink-0">
                                  Active
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-xs text-slate-500">
                              {getProviderSummary(account)}
                              {account.email ? ` · ${account.email}` : ""}
                            </p>
                            {account.providers.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {account.providers.map((provider) => {
                                  const ProviderBadgeIcon = getProviderIcon(
                                    provider.type,
                                  );
                                  return (
                                    <Badge
                                      key={`${account.accountId}-${provider.type}`}
                                      variant="secondary"
                                      className={cn(
                                        "gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                        getProviderBadgeClasses(provider.type),
                                      )}
                                    >
                                      <ProviderBadgeIcon className="h-3 w-3" />
                                      {provider.label}
                                    </Badge>
                                  );
                                })}
                              </div>
                            )}
                            {!account.isValid && (
                              <p className="mt-1 text-xs text-red-600">
                                {account.invalidReason ||
                                  "This user needs to be added again."}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                          <Button
                            type="button"
                            variant={isActive ? "secondary" : "outline"}
                            size="sm"
                            className={cn(
                              "h-9 rounded-full px-3",
                              isActive
                                ? "bg-slate-900 text-white hover:bg-slate-900"
                                : "border-slate-300 bg-white hover:bg-slate-50",
                            )}
                            disabled={isActive}
                            onClick={() =>
                              void switchAccount(account.accountId)
                            }
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            {isActive ? "Current" : "Switch"}
                          </Button>

                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
                            aria-label={`Log out ${accountLabel}`}
                            onClick={() =>
                              openLogoutDialog({ kind: "account", account })
                            }
                          >
                            <LogOut className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={handleOpenEmailDialog}>
                  <Mail className="h-4 w-4" />
                  Sign in with email
                </DropdownMenuItem>

                {configuredProviders.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onSelect={() =>
                      beginOAuthLogin(provider.id, { addAccount: true })
                    }
                  >
                    {(() => {
                      const ProviderIcon = getProviderIcon(provider.id);
                      return <ProviderIcon className="h-4 w-4" />;
                    })()}
                    Sign in with {provider.displayName}
                  </DropdownMenuItem>
                ))}

                {accounts.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        openLogoutDialog({
                          kind: "current",
                          account: activeAccount,
                        })
                      }
                      variant="destructive"
                      disabled={!activeAccountId}
                    >
                      <LogOut className="h-4 w-4" />
                      Log out current user
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => openLogoutDialog({ kind: "all" })}
                      variant="destructive"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out all users
                    </DropdownMenuItem>
                  </>
                )}

                {(logoutDialogError || error) && (
                  <div className="px-1 pt-2">
                    <Alert className="border-red-200 bg-red-50 text-red-900">
                      <AlertDescription>
                        {logoutDialogError || error}
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </DropdownMenuContent>

              {!isExpanded && (
                <div className="pointer-events-none absolute left-full bottom-0 ml-4 translate-x-2 rounded-xl bg-gradient-to-br from-sidebar-primary to-sidebar-primary/90 px-3 py-2 whitespace-nowrap text-sidebar-primary-foreground opacity-0 shadow-lg transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 z-50">
                  <div className="text-sm font-medium">{userName}</div>
                  <div className="mt-1 text-xs opacity-75">
                    {user?.email || activeAccount?.email || "Account switcher"}
                  </div>
                  <div className="mt-1 text-[11px] opacity-60">
                    Click to switch or add users
                  </div>
                  <div className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1 -translate-y-1/2 rotate-45 bg-sidebar-primary" />
                </div>
              )}
            </div>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog
        open={pendingLogoutAction !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            closeLogoutDialog();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{logoutDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {logoutDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {logoutDialogError && (
            <Alert className="border-red-200 bg-red-50 text-red-900">
              <AlertDescription>{logoutDialogError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessingLogout}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isProcessingLogout}
              onClick={() => void handleConfirmLogout()}
            >
              {isProcessingLogout ? "Logging out..." : "Confirm logout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={isEmailDialogOpen}
        onOpenChange={(open: boolean) => {
          setIsEmailDialogOpen(open);
          if (!open) {
            setEmailFormError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in with email</DialogTitle>
            <DialogDescription>
              Sign in with another verified email/password user without removing
              the users already stored in this browser session.
            </DialogDescription>
          </DialogHeader>

          {(emailFormError || error) && (
            <Alert className="border-red-200 bg-red-50 text-red-900">
              <AlertDescription>{emailFormError || error}</AlertDescription>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={handleAddEmailAccount}>
            <div className="space-y-2">
              <Label htmlFor="sidebar-email-account">Email</Label>
              <Input
                id="sidebar-email-account"
                type="email"
                autoComplete="email"
                value={emailCredentials.email}
                onChange={(event) =>
                  handleEmailDialogChange("email", event.target.value)
                }
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sidebar-email-password">Password</Label>
              <Input
                id="sidebar-email-password"
                type="password"
                autoComplete="current-password"
                value={emailCredentials.password}
                onChange={(event) =>
                  handleEmailDialogChange("password", event.target.value)
                }
                placeholder="Enter your password"
                required
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEmailDialogOpen(false)}
                disabled={isAddingEmailAccount}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isAddingEmailAccount}>
                {isAddingEmailAccount ? "Signing in..." : "Sign in"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
