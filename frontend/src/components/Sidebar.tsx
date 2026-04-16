import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Database,
  FolderKanban,
  Github,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { GoogleIcon } from "./ui/provider-icons";
import { cn } from "./ui/utils";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

type PendingLogoutAction =
  | { kind: "account"; account: SessionAccountSummary }
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
      return GoogleIcon;
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
      return "bg-white text-slate-700 ring-1 ring-slate-200";
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
      return `Remove ${getAccountLabel(pendingLogoutAction.account)}?`;
    }

    return "Sign out all accounts?";
  }, [pendingLogoutAction]);

  const logoutDialogDescription = useMemo(() => {
    if (!pendingLogoutAction) {
      return "";
    }

    if (pendingLogoutAction.kind === "account") {
      return "This removes only the selected user from the current browser session. Other signed-in users stay available.";
    }

    return "This signs every account out of the current browser session and clears the session cookie.";
  }, [pendingLogoutAction]);

  const navigationItems = [
    {
      id: "studio",
      name: "Resonator",
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
          "relative flex h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-[2rem] border border-sidebar-border/20 bg-gradient-to-b from-sidebar via-sidebar to-sidebar-accent shadow-[0_24px_70px_rgba(15,23,42,0.24)] transition-all duration-300 ease-in-out",
          isExpanded ? "w-72" : "w-20",
        )}
      >
        <div
          className={cn(
            "relative border-b border-white/10 bg-white/[0.03] backdrop-blur-[2px]",
            isExpanded ? "px-5 py-5" : "px-4 py-5",
          )}
        >
          <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/14" />
          <div
            className={cn(
              "flex items-center",
              isExpanded ? "gap-3" : "justify-center",
            )}
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.35rem] border border-white/70 bg-white shadow-[0_14px_30px_rgba(255,255,255,0.16)] ring-1 ring-black/5">
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
                "flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/6 text-sidebar-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:bg-white/10 hover:shadow-[0_10px_25px_rgba(15,23,42,0.18)]",
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
                      "relative flex items-center overflow-hidden border border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_28px_rgba(15,23,42,0.16)]",
                      isExpanded
                        ? "w-full justify-start rounded-2xl px-4 py-3.5"
                        : "mx-auto h-12 w-12 justify-center rounded-[1.1rem]",
                      isActive
                        ? "border-white/15 bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 shadow-[0_18px_35px_rgba(34,197,94,0.18)] ring-1 ring-white/12"
                        : "border-white/8 bg-white/6 hover:border-white/20 hover:bg-white/12",
                    )}
                  >
                    {!isActive && isExpanded && (
                      <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/8" />
                    )}

                    <Icon
                      className={cn(
                        "h-5 w-5 shrink-0 transition-colors duration-300",
                        isActive
                          ? "text-white"
                          : "text-white/90 group-hover:text-white",
                      )}
                    />

                    {isExpanded && (
                      <div className="ml-3 overflow-hidden">
                        <div
                          className={cn(
                            "whitespace-nowrap text-sm font-medium transition-colors duration-300",
                            isActive
                              ? "text-white"
                              : "text-white/92 group-hover:text-white",
                          )}
                        >
                          {item.name}
                        </div>
                        {isActive && (
                          <div className="mt-0.5 whitespace-nowrap text-xs text-white/72">
                            {item.description}
                          </div>
                        )}
                      </div>
                    )}

                    {isActive && !isExpanded && (
                      <>
                        <div className="absolute inset-0 animate-pulse rounded-[1.1rem] bg-sidebar-primary opacity-20" />
                        <div className="absolute -right-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-l-full bg-sidebar-primary" />
                      </>
                    )}

                    {isActive && isExpanded && (
                      <div className="absolute right-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-sidebar-primary-foreground shadow-[0_0_0_4px_rgba(255,255,255,0.08)]" />
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

        <div className="border-t border-white/10 bg-gradient-to-b from-transparent to-black/5 p-4 backdrop-blur-sm">
          <DropdownMenu>
            <div className="relative group">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center rounded-[1.6rem] border border-white/10 bg-white/6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/9 hover:shadow-[0_16px_32px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary/60",
                    isExpanded ? "gap-3 px-3 py-3" : "justify-center px-2 py-3",
                  )}
                  aria-label="Open account menu"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 text-lg font-semibold text-sidebar-primary-foreground shadow-[0_14px_26px_rgba(34,197,94,0.2)]">
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
                className="w-80 rounded-[1.75rem] border border-slate-200/80 bg-white/95 px-2.5 pt-2.5 pb-3.5 shadow-[0_28px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl"
                collisionPadding={{ top: 16, right: 16, bottom: 24, left: 16 }}
                side={isExpanded ? "top" : "right"}
                sideOffset={24}
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
                          "grid grid-cols-[auto,minmax(0,1fr),auto] items-start gap-2.5 rounded-[1.15rem] border px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-all duration-200",
                          isActive
                            ? "border-sky-200 bg-sky-50 shadow-[0_12px_24px_rgba(14,165,233,0.08)]"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-[0_10px_20px_rgba(15,23,42,0.06)]",
                        )}
                      >
                        <div className="relative mt-0.5 shrink-0">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                            {accountInitials || "AU"}
                          </div>
                          <div
                            className={cn(
                              "absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white",
                              getProviderBadgeClasses(
                                primaryProvider?.type || "email",
                              ),
                            )}
                          >
                            <ProviderIcon className="h-2.5 w-2.5" />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {accountLabel}
                            </p>
                            {isActive && (
                              <Badge
                                variant="secondary"
                                className="shrink-0 rounded-full px-1.5 py-0 text-[10px] leading-4"
                              >
                                Active
                              </Badge>
                            )}
                          </div>
                          {account.email && (
                            <p
                              className="mt-0.5 truncate text-xs font-medium text-slate-600"
                              title={account.email}
                            >
                              {account.email}
                            </p>
                          )}
                          {account.providers.length > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              {account.providers.map((provider) => {
                                const ProviderBadgeIcon = getProviderIcon(
                                  provider.type,
                                );
                                return (
                                  <span
                                    key={`${account.accountId}-${provider.type}`}
                                    aria-label={provider.label}
                                    className={cn(
                                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                                      getProviderBadgeClasses(provider.type),
                                    )}
                                    title={provider.label}
                                  >
                                    <ProviderBadgeIcon className="h-2.5 w-2.5" />
                                  </span>
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

                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <Button
                            type="button"
                            variant={isActive ? "secondary" : "outline"}
                            size="sm"
                            className={cn(
                              "h-8 gap-1 rounded-full px-2.5 text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]",
                              isActive
                                ? "bg-slate-900 text-white hover:bg-slate-900"
                                : "border-slate-300 bg-white hover:bg-slate-50",
                            )}
                            disabled={isActive}
                            onClick={() =>
                              void switchAccount(account.accountId)
                            }
                          >
                            {!isActive && (
                              <ArrowRightLeft className="h-3 w-3" />
                            )}
                            {isActive ? "Current" : "Switch"}
                          </Button>

                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
                            aria-label={`Remove ${accountLabel} from this session`}
                            title={`Remove ${accountLabel} from this session`}
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

                <div className="px-1 pt-2 pb-1">
                  <div className="rounded-[1.3rem] border border-slate-200 bg-slate-50/90 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="rounded-xl px-2.5 py-2.5 data-[state=open]:bg-white">
                        <KeyRound className="mr-3.5 h-4 w-4 shrink-0 text-slate-600" />
                        <div className="flex min-w-0 flex-col items-start">
                          <span className="text-sm font-medium text-slate-900">
                            Add account
                          </span>
                          <span className="text-xs text-slate-500">
                            Email or connected providers
                          </span>
                        </div>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-60 rounded-[1.2rem] border border-slate-200/80 bg-white/95 p-1.5 shadow-[0_22px_50px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                        <DropdownMenuItem
                          className="rounded-xl px-2.5 py-2.5"
                          onSelect={handleOpenEmailDialog}
                        >
                          <Mail className="h-4 w-4" />
                          <div className="ml-1 flex flex-col items-start">
                            <span className="font-medium text-slate-900">
                              Email
                            </span>
                            <span className="text-xs text-slate-500">
                              Add another email account
                            </span>
                          </div>
                        </DropdownMenuItem>

                        {configuredProviders.map((provider) => (
                          <DropdownMenuItem
                            key={provider.id}
                            className="rounded-xl px-2.5 py-2.5"
                            onSelect={() =>
                              beginOAuthLogin(provider.id, { addAccount: true })
                            }
                          >
                            {(() => {
                              const ProviderIcon = getProviderIcon(provider.id);
                              return <ProviderIcon className="h-4 w-4" />;
                            })()}
                            <div className="ml-1 flex flex-col items-start">
                              <span className="font-medium text-slate-900">
                                {provider.displayName}
                              </span>
                              <span className="text-xs text-slate-500">
                                Add with {provider.displayName}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {accounts.length > 0 && (
                      <>
                        <div className="mx-2.5 my-1.5 h-px bg-slate-200" />
                        <DropdownMenuItem
                          className="rounded-xl px-2.5 py-2.5"
                          onSelect={() => openLogoutDialog({ kind: "all" })}
                          variant="destructive"
                        >
                          <LogOut className="h-4 w-4" />
                          <div className="ml-1 flex flex-col items-start">
                            <span className="font-medium text-current">
                              Sign out all accounts
                            </span>
                            <span className="text-xs text-slate-500">
                              Clear this browser session
                            </span>
                          </div>
                        </DropdownMenuItem>
                      </>
                    )}
                  </div>
                </div>

                {(logoutDialogError || error) && (
                  <div className="px-1 pt-2 pb-1">
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
