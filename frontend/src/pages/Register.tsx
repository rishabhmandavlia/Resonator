/**
 * Register Page Component
 * OAuth-based account creation flow.
 */

import { Globe2, KeyRound, Layers3 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useAuth } from "../services/auth";

export function Register() {
  const [searchParams] = useSearchParams();
  const { beginOAuthLogin, providers, error, isLoading } = useAuth();

  const configuredProviders = providers.filter(
    (provider) => provider.isConfigured,
  );
  const displayError = searchParams.get("authError") || error;

  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,#f8fafc_0%,#ecfeff_40%,#e0f2fe_100%)] px-6 py-12">
      <div className="mx-auto grid min-h-[calc(100vh-6rem)] max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[2rem] border border-cyan-100/80 bg-slate-950 p-8 text-white shadow-[0_30px_80px_rgba(8,47,73,0.22)] md:p-10">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
                Multi-Account Identity
              </p>
              <h1 className="font-serif text-4xl tracking-tight md:text-5xl">
                Create an account through your identity provider.
              </h1>
              <p className="text-lg leading-8 text-slate-300">
                Sign-up and sign-in use the same OAuth flow, so every provider
                account becomes a distinct entry in the same browser session.
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <Layers3 className="h-6 w-6 text-cyan-300" />
                <p className="mt-3 text-sm font-semibold">
                  Independent account storage
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Each provider account keeps its own access token, refresh
                  token, ID token, and expiry state.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <KeyRound className="h-6 w-6 text-cyan-300" />
                <p className="mt-3 text-sm font-semibold">
                  Per-account refresh
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Expired tokens refresh individually. Failed refresh marks only
                  that account invalid.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <Globe2 className="h-6 w-6 text-cyan-300" />
                <p className="mt-3 text-sm font-semibold">OIDC-compatible</p>
                <p className="mt-1 text-sm text-slate-300">
                  The backend uses authorization code flow with PKCE and
                  account-selection prompts where the provider supports them.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-8 shadow-[0_30px_80px_rgba(15,23,42,0.08)] md:p-10">
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Start with an OAuth provider
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Pick a provider below. If the identity is new, the backend
                creates the matching app user automatically.
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
                  variant="outline"
                  className="h-12 w-full justify-between rounded-xl border-slate-300 px-5 text-slate-900 hover:bg-slate-50"
                  disabled={isLoading}
                  onClick={() => beginOAuthLogin(provider.id)}
                >
                  <span>Create or continue with {provider.displayName}</span>
                  <span className="text-xs uppercase tracking-[0.25em] text-slate-500">
                    OAuth
                  </span>
                </Button>
              ))}
            </div>

            {configuredProviders.length === 0 && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertDescription>
                  No OAuth providers are configured yet. Add provider
                  credentials to the backend environment before using this flow.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-sm text-slate-600">
              Already have access?{" "}
              <Link
                to="/login"
                className="font-medium text-sky-700 hover:text-sky-800"
              >
                Return to sign in
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
