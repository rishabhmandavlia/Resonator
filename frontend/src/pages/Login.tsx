/**
 * Login Page Component
 * Entry point for OAuth-based multi-account sign-in.
 */

import { ArrowLeftRight, ShieldCheck, UserPlus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useAuth } from "../services/auth";

export function Login() {
  const [searchParams] = useSearchParams();
  const { beginOAuthLogin, providers, error, isLoading } = useAuth();

  const configuredProviders = providers.filter(
    (provider) => provider.isConfigured,
  );
  const displayError = searchParams.get("authError") || error;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_38%),linear-gradient(135deg,#eff6ff_0%,#dbeafe_45%,#f8fafc_100%)] px-6 py-12">
      <div className="mx-auto grid min-h-[calc(100vh-6rem)] max-w-6xl gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[2rem] border border-sky-100/80 bg-white/80 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-12">
          <div className="max-w-xl space-y-8">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">
                OAuth 2.0 Session Auth
              </p>
              <h1 className="font-serif text-4xl tracking-tight text-slate-900 md:text-5xl">
                Sign in once, switch accounts instantly.
              </h1>
              <p className="text-lg leading-8 text-slate-600">
                This workspace now uses browser-session OAuth with multiple
                stored accounts, per-account tokens, and instant account
                switching without forcing a new login.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4">
                <ShieldCheck className="h-6 w-6 text-sky-600" />
                <p className="mt-3 text-sm font-semibold text-slate-900">
                  Secure cookies
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Tokens stay on the backend in the session store, not in
                  localStorage.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4">
                <ArrowLeftRight className="h-6 w-6 text-sky-600" />
                <p className="mt-3 text-sm font-semibold text-slate-900">
                  Multi-account
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Add Google and GitHub accounts to the same session and swap
                  active users instantly.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4">
                <UserPlus className="h-6 w-6 text-sky-600" />
                <p className="mt-3 text-sm font-semibold text-slate-900">
                  Select account
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  New sign-ins request account selection so existing sessions
                  are never overwritten.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-8 shadow-[0_30px_80px_rgba(15,23,42,0.08)] md:p-10">
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Continue with a provider
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Choose an OAuth provider to start a browser session. You can add
                more accounts later from the profile badge.
              </p>
            </div>

            {displayError && (
              <Alert className="border-red-200 bg-red-50 text-red-900">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              {configuredProviders.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  className="h-12 w-full justify-between rounded-xl bg-slate-900 px-5 text-white hover:bg-slate-800"
                  disabled={isLoading}
                  onClick={() => beginOAuthLogin(provider.id)}
                >
                  <span>Continue with {provider.displayName}</span>
                  <span className="text-xs uppercase tracking-[0.25em] text-white/70">
                    OAuth
                  </span>
                </Button>
              ))}
            </div>

            {configuredProviders.length === 0 && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertDescription>
                  No OAuth providers are configured yet. Set the provider client
                  IDs and secrets in the backend environment.
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              The backend stores each account separately with its own token set,
              refresh state, and expiry. Switching accounts only changes the
              active account in the current browser session.
            </div>

            <p className="text-sm text-slate-600">
              Need the sign-up wording instead? Visit{" "}
              <Link
                to="/register"
                className="font-medium text-sky-700 hover:text-sky-800"
              >
                the account creation page
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
