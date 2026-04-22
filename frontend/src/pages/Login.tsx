import { Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import resonatorLogo from "../assets/resonator-logo.svg";
import resonatorWordmark from "../assets/resonator-wordmark.svg";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { GoogleIcon } from "../components/ui/provider-icons";
import { useAuth } from "../services/auth";

function getProviderIcon(providerId: string) {
  switch (providerId) {
    case "google":
      return GoogleIcon;
    default:
      return KeyRound;
  }
}

export function Login() {
  const [searchParams] = useSearchParams();
  const { beginOAuthLogin, clearError, error, isLoading, login, providers } =
    useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const configuredProviders = useMemo(
    () => providers.filter((provider) => provider.isConfigured),
    [providers],
  );
  const displayError = searchParams.get("authError") || formError || error;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    clearError();
    setIsSubmitting(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setFormError(err?.detail || err?.message || "Failed to sign in");
    } finally {
      setIsSubmitting(false);
    }
  };

  const oauthDisabled = isLoading || isSubmitting;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfe_52%,#f5f7fa_100%)] px-6 py-10">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-6rem] h-72 w-72 rounded-full bg-slate-200/50 blur-3xl" />
        <div className="absolute bottom-[-8rem] right-[-3rem] h-80 w-80 rounded-full bg-slate-100/80 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative overflow-hidden rounded-[2.5rem] border border-sky-950/10 bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.18),_transparent_38%),linear-gradient(155deg,#0b1b47_0%,#065f46_52%,#192d63_100%)] p-8 text-white shadow-[0_35px_100px_rgba(15,23,42,0.18)] md:p-12">
          <div className="absolute right-[-5rem] top-[-4rem] h-56 w-56 rounded-full border border-white/10" />
          <div className="absolute right-8 top-12 h-36 w-36 rounded-full border border-white/10" />

          <div className="relative flex h-full flex-col justify-between gap-10">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.75rem] bg-white shadow-lg">
                <img
                  src={resonatorLogo}
                  alt="Resonator logo"
                  className="h-14 w-14"
                />
              </div>
              <div className="min-w-0">
                <img
                  src={resonatorWordmark}
                  alt="Resonator"
                  className="h-11 w-auto max-w-[14rem]"
                />
                <p className="mt-2 text-sm uppercase tracking-[0.28em] text-sky-100/80">
                  AI Voice Generator
                </p>
              </div>
            </div>

            <div className="max-w-xl space-y-5">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-100/85">
                Workspace Access
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl md:leading-[1.05]">
                Sign in to the studio where your voices, projects, and history
                live.
              </h1>
              <p className="text-lg leading-8 text-sky-50/82">
                Resonator keeps your voice workspace in one place so returning
                to work feels immediate, not technical.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/80">
                  Voice Library
                </p>
                <p className="mt-2 text-sm leading-6 text-white/82">
                  Keep your saved voices and generation history attached to the
                  same workspace.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/80">
                  Secure Access
                </p>
                <p className="mt-2 text-sm leading-6 text-white/82">
                  Use the sign-in method already connected to your Resonator
                  account.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/80">
                  Fast Return
                </p>
                <p className="mt-2 text-sm leading-6 text-white/82">
                  Jump back into projects without digging through setup details
                  every time.
                </p>
              </div>
            </div>
          </div>
        </section>

        <Card className="rounded-[2.25rem] border border-white/70 bg-white/92 shadow-[0_30px_90px_rgba(15,23,42,0.10)] backdrop-blur">
          <CardHeader className="space-y-4 px-8 pt-8 md:px-10 md:pt-10">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm">
                <img
                  src={resonatorLogo}
                  alt="Resonator logo"
                  className="h-10 w-10"
                />
              </div>
              <div className="min-w-0">
                <div className="inline-flex py-2">
                  <img
                    src={resonatorWordmark}
                    alt="Resonator"
                    className="h-8 w-auto max-w-[11rem]"
                    style={{
                      filter:
                        "brightness(0) saturate(100%) invert(31%) sepia(67%) saturate(908%) hue-rotate(129deg) brightness(94%) contrast(97%)",
                    }}
                  />
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-600">
                  Sign In
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-tight text-slate-900">
                Welcome back
              </CardTitle>
              <CardDescription className="text-sm leading-6 text-slate-600">
                Sign in with the method already linked to your account.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 px-8 pb-8 md:px-10 md:pb-10">
            {displayError && (
              <Alert className="border-red-200 bg-red-50 text-red-900">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (formError) {
                      setFormError(null);
                    }
                  }}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (formError) {
                        setFormError(null);
                      }
                    }}
                    placeholder="Enter your password"
                    className="pr-11"
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="h-11 w-full rounded-xl bg-emerald-700 text-white hover:bg-emerald-800"
                disabled={isSubmitting || isLoading}
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>

              <p className="text-xs leading-5 text-slate-500">
                Email/password access becomes available after email
                verification.
              </p>
            </form>

            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-400">
              <div className="h-px flex-1 bg-slate-200" />
              Other sign-in methods
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="space-y-3">
              {configuredProviders.map((provider) => {
                const ProviderIcon = getProviderIcon(provider.id);

                return (
                  <Button
                    key={provider.id}
                    type="button"
                    variant="outline"
                    className="h-11 w-full justify-start rounded-xl border-slate-300 px-4 text-slate-900 hover:bg-slate-50"
                    disabled={oauthDisabled}
                    onClick={() => beginOAuthLogin(provider.id)}
                  >
                    <span className="flex items-center gap-3">
                      <ProviderIcon className="h-4 w-4" />
                      Continue with {provider.displayName}
                    </span>
                  </Button>
                );
              })}
            </div>

            {configuredProviders.length === 0 && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertDescription>
                  External sign-in is unavailable right now. Use email and
                  password instead.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-sm text-slate-600">
              Need a new account?{" "}
              <Link
                to="/register"
                className="font-medium text-sky-700 transition underline hover:text-sky-800"
              >
                Create one
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
