import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Database,
  FolderKanban,
  History,
  LogOut,
  Mic2,
  Plus,
  Settings,
  Trash2,
  Waves,
} from "lucide-react";

import { useAuth } from "../services/auth";
import { Badge } from "./ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "./ui/utils";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

function buildInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const {
    user,
    accounts,
    activeAccountId,
    activeAccount,
    providers,
    hasValidActiveAccount,
    beginOAuthLogin,
    switchAccount,
    removeAccount,
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

    return "Session Accounts";
  }, [activeAccount?.displayName, user?.displayName, user?.email]);

  const userInitials = useMemo(() => {
    const source =
      userName || user?.email || activeAccount?.providerLabel || "AU";
    return buildInitials(source);
  }, [activeAccount?.providerLabel, user?.email, userName]);

  const configuredProviders = providers.filter(
    (provider) => provider.isConfigured,
  );

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
        <div className="relative flex flex-col items-center p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 shadow-lg">
            <Waves className="h-6 w-6 text-sidebar-primary-foreground" />
          </div>
          {isExpanded && (
            <div className="mt-3 text-center">
              <h2 className="whitespace-nowrap text-base font-semibold text-sidebar-foreground">
                Kokoro TTS
              </h2>
              <p className="mt-1 whitespace-nowrap text-xs text-sidebar-foreground/70">
                Audio Generation
              </p>
            </div>
          )}
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
                            "No active account"}
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
                          "No active account selected"}
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
                      No accounts are connected in this browser session yet.
                    </div>
                  )}

                  {accounts.map((account) => {
                    const accountLabel =
                      account.displayName ||
                      account.email ||
                      `${account.providerLabel} account`;
                    const accountInitials = buildInitials(
                      accountLabel || account.providerLabel,
                    );
                    const isActive = account.accountId === activeAccountId;

                    return (
                      <div
                        key={account.accountId}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-2 py-2",
                          isActive
                            ? "border-sky-200 bg-sky-50"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          onClick={() => void switchAccount(account.accountId)}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                            {accountInitials || "AU"}
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
                              {account.providerLabel}
                              {account.email ? ` · ${account.email}` : ""}
                            </p>
                            {!account.isValid && (
                              <p className="mt-1 text-xs text-red-600">
                                {account.invalidReason ||
                                  "This account needs to be added again."}
                              </p>
                            )}
                          </div>
                        </button>

                        <button
                          type="button"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
                          aria-label={`Remove ${accountLabel}`}
                          onClick={() => void removeAccount(account.accountId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <DropdownMenuSeparator />

                {configuredProviders.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() =>
                      beginOAuthLogin(provider.id, { addAccount: true })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Add {provider.displayName} account
                  </DropdownMenuItem>
                ))}

                {accounts.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => void logoutAll()}
                      variant="destructive"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out all accounts
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>

              {!isExpanded && (
                <div className="pointer-events-none absolute left-full bottom-0 ml-4 translate-x-2 rounded-xl bg-gradient-to-br from-sidebar-primary to-sidebar-primary/90 px-3 py-2 whitespace-nowrap text-sidebar-primary-foreground opacity-0 shadow-lg transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 z-50">
                  <div className="text-sm font-medium">{userName}</div>
                  <div className="mt-1 text-xs opacity-75">
                    {user?.email || activeAccount?.email || "Account switcher"}
                  </div>
                  <div className="mt-1 text-[11px] opacity-60">
                    Click to switch or add accounts
                  </div>
                  <div className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1 -translate-y-1/2 rotate-45 bg-sidebar-primary" />
                </div>
              )}
            </div>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
