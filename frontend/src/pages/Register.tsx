import { Eye, EyeOff, KeyRound, Mail, RefreshCcw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "../components/ui/input-otp";
import { Label } from "../components/ui/label";
import { GoogleIcon } from "../components/ui/provider-icons";
import type { RegistrationChallengeResponse } from "../services/api";
import { useAuth } from "../services/auth";

function getProviderIcon(providerId: string) {
  switch (providerId) {
    case "google":
      return GoogleIcon;
    default:
      return KeyRound;
  }
}

function getProviderDisplayName(providerId: string | null) {
  switch (providerId) {
    case "google":
      return "Google";
    default:
      return "OAuth provider";
  }
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    beginOAuthLogin,
    clearError,
    error,
    isLoading,
    providers,
    register,
    resendOtp,
    resendOAuthLink,
    verifyEmail,
    verifyOAuthLink,
  } = useAuth();
  const oauthLinkMode = searchParams.get("mode") === "oauth-link";
  const oauthLinkProvider = searchParams.get("provider");
  const oauthLinkEmail = searchParams.get("email") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [challenge, setChallenge] =
    useState<RegistrationChallengeResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resendRemainingSeconds, setResendRemainingSeconds] = useState(0);

  const configuredProviders = useMemo(
    () => providers.filter((provider) => provider.isConfigured),
    [providers],
  );
  const displayError = formError || error;
  const isOtpStep = challenge !== null;
  const oauthLinkChallenge =
    useMemo<RegistrationChallengeResponse | null>(() => {
      if (!oauthLinkMode) {
        return null;
      }

      const message = searchParams.get("message");
      const expiresAt = searchParams.get("expiresAt");
      const resendAvailableAt = searchParams.get("resendAvailableAt");
      if (!oauthLinkEmail || !message || !expiresAt || !resendAvailableAt) {
        return null;
      }

      return {
        email: oauthLinkEmail,
        message,
        expiresAt,
        resendAvailableAt,
        resendCooldownSeconds: 30,
        resendAvailableInSeconds: Math.max(
          0,
          Math.ceil(
            (new Date(resendAvailableAt).getTime() - Date.now()) / 1000,
          ),
        ),
        verificationType: "oauth_link",
        provider: oauthLinkProvider,
      };
    }, [oauthLinkEmail, oauthLinkMode, oauthLinkProvider, searchParams]);

  useEffect(() => {
    if (!oauthLinkChallenge) {
      return;
    }

    setEmail(oauthLinkChallenge.email);
    setChallenge(oauthLinkChallenge);
  }, [oauthLinkChallenge]);

  useEffect(() => {
    if (!challenge) {
      setResendRemainingSeconds(0);
      return;
    }

    const updateRemaining = () => {
      const seconds = Math.max(
        0,
        Math.ceil(
          (new Date(challenge.resendAvailableAt).getTime() - Date.now()) / 1000,
        ),
      );
      setResendRemainingSeconds(seconds);
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [challenge]);

  const handleRegistrationSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setFormError(null);
    clearError();

    if (password !== confirmPassword) {
      setFormError("Password and confirm password must match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const nextChallenge = await register(email, password);
      setChallenge(nextChallenge);
      setOtp("");
    } catch (err: any) {
      setFormError(
        err?.detail || err?.message || "Failed to start registration",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    clearError();

    if (otp.length !== 6) {
      setFormError("Enter the 6-digit verification code.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (challenge?.verificationType === "oauth_link") {
        await verifyOAuthLink(email, otp);
        navigate("/", { replace: true });
      } else {
        await verifyEmail(email, otp);
      }
    } catch (err: any) {
      setFormError(err?.detail || err?.message || "Failed to verify email");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setFormError(null);
    clearError();
    setIsResending(true);

    try {
      const nextChallenge =
        challenge?.verificationType === "oauth_link"
          ? await resendOAuthLink(email)
          : await resendOtp(email);
      setChallenge(nextChallenge);
      setOtp("");
    } catch (err: any) {
      setFormError(err?.detail || err?.message || "Failed to resend code");
    } finally {
      setIsResending(false);
    }
  };

  const handleEditDetails = () => {
    if (challenge?.verificationType === "oauth_link") {
      navigate("/login");
      return;
    }

    setChallenge(null);
    setOtp("");
    setFormError(null);
    clearError();
  };

  const passwordsMatch = password === confirmPassword;
  const isOAuthLinkStep = challenge?.verificationType === "oauth_link";
  const oauthProviderDisplayName = getProviderDisplayName(oauthLinkProvider);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(155deg,#f8fafc_0%,#fefce8_42%,#ecfccb_100%)] px-6 py-12">
      <div className="mx-auto grid min-h-[calc(100vh-6rem)] max-w-6xl gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[2rem] border border-white/60 bg-slate-950 p-8 text-white shadow-[0_30px_90px_rgba(15,23,42,0.2)] md:p-12">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-300">
                Registration Flow
              </p>
              <h1 className="font-serif text-4xl tracking-tight md:text-5xl">
                {oauthLinkMode
                  ? `Verify your email to link ${oauthProviderDisplayName}.`
                  : "Create your account, then verify the email with OTP."}
              </h1>
              <p className="text-lg leading-8 text-slate-300">
                {oauthLinkMode
                  ? `Finish the OTP step to attach ${oauthProviderDisplayName} to the correct user without creating a duplicate account.`
                  : "Registration is now split into two steps. We only activate the email account after the verification code is confirmed."}
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <Mail className="h-5 w-5 text-emerald-300" />
                <p className="mt-3 text-sm font-semibold">
                  Step 1: email + password
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Submit your credentials to receive a 6-digit verification
                  code.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <KeyRound className="h-5 w-5 text-emerald-300" />
                <p className="mt-3 text-sm font-semibold">
                  Step 2: OTP verification
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Codes expire after a short window and login stays blocked
                  until verification succeeds.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <GoogleIcon className="h-5 w-5" />
                <p className="mt-3 text-sm font-semibold">
                  OAuth still available
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Google continues to use the existing multi-account OAuth
                  session flow.
                </p>
              </div>
            </div>
          </div>
        </section>

        <Card className="rounded-[2rem] border-slate-200/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.08)]">
          <CardHeader className="space-y-2 px-8 pt-8 md:px-10 md:pt-10">
            <CardTitle className="text-2xl font-semibold tracking-tight text-slate-900">
              {isOtpStep
                ? isOAuthLinkStep
                  ? `Verify ${oauthProviderDisplayName} email`
                  : "Verify your email"
                : "Create account"}
            </CardTitle>
            <CardDescription className="text-sm leading-6 text-slate-600">
              {isOtpStep
                ? `Enter the code sent to ${email}.`
                : "Use email/password for registration or continue with Google."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 px-8 pb-8 md:px-10 md:pb-10">
            {displayError && (
              <Alert className="border-red-200 bg-red-50 text-red-900">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            )}

            {!isOtpStep && !oauthLinkMode && (
              <>
                <form className="space-y-4" onSubmit={handleRegistrationSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
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
                    <Label htmlFor="register-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="register-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          if (formError) {
                            setFormError(null);
                          }
                        }}
                        placeholder="Minimum 8 characters"
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

                  <div className="space-y-2">
                    <Label htmlFor="register-confirm-password">
                      Confirm password
                    </Label>
                    <div className="relative">
                      <Input
                        id="register-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value);
                          if (formError) {
                            setFormError(null);
                          }
                        }}
                        placeholder="Repeat your password"
                        className="pr-11"
                        required
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700"
                        aria-label={
                          showConfirmPassword
                            ? "Hide confirm password"
                            : "Show confirm password"
                        }
                        onClick={() =>
                          setShowConfirmPassword((current) => !current)
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {confirmPassword.length > 0 && !passwordsMatch && (
                      <p className="text-xs text-red-600">
                        Password and confirm password must match.
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    disabled={isSubmitting || isLoading || !passwordsMatch}
                  >
                    {isSubmitting ? "Sending code..." : "Create account"}
                  </Button>
                </form>

                <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  Or continue with
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
                        className="h-11 w-full justify-between rounded-xl border-slate-300 px-4 text-slate-900 hover:bg-slate-50"
                        disabled={isLoading || isSubmitting}
                        onClick={() => beginOAuthLogin(provider.id)}
                      >
                        <span className="flex items-center gap-3">
                          <ProviderIcon className="h-4 w-4" />
                          Continue with {provider.displayName}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                          OAuth
                        </span>
                      </Button>
                    );
                  })}
                </div>

                {configuredProviders.length === 0 && (
                  <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                    <AlertDescription>
                      No OAuth providers are configured yet. Add the provider
                      client credentials in the backend environment first.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {!isOtpStep && oauthLinkMode && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertDescription>
                  The pending {oauthProviderDisplayName} verification details
                  are missing. Start the OAuth login again to request a fresh
                  OTP.
                </AlertDescription>
              </Alert>
            )}

            {isOtpStep && challenge && (
              <form className="space-y-6" onSubmit={handleVerifySubmit}>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  <p className="font-medium text-slate-900">
                    {challenge.message}
                  </p>
                  <p className="mt-2">
                    The code expires at{" "}
                    {new Date(challenge.expiresAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    .
                  </p>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="register-otp">Verification code</Label>
                  <InputOTP
                    id="register-otp"
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                    inputMode="numeric"
                    containerClassName="justify-center"
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
                  <p className="text-center text-xs text-slate-500">
                    Enter the 6-digit code sent to {email}.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl border-slate-300"
                    onClick={handleEditDetails}
                    disabled={isSubmitting || isResending}
                  >
                    {isOAuthLinkStep
                      ? "Back to sign in"
                      : "Edit email or password"}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-xl text-slate-700 hover:bg-slate-100"
                    onClick={() => void handleResend()}
                    disabled={
                      resendRemainingSeconds > 0 || isResending || isSubmitting
                    }
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {isResending
                      ? "Resending..."
                      : resendRemainingSeconds > 0
                        ? `Resend in ${formatCountdown(resendRemainingSeconds)}`
                        : "Resend code"}
                  </Button>
                </div>

                <Button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                  disabled={isSubmitting || otp.length !== 6}
                >
                  {isSubmitting
                    ? "Verifying..."
                    : isOAuthLinkStep
                      ? `Verify and link ${oauthProviderDisplayName}`
                      : "Verify and continue"}
                </Button>
              </form>
            )}

            <p className="text-sm text-slate-600">
              Already have access?{" "}
              <Link
                to="/login"
                className="font-medium text-sky-700 transition hover:text-sky-800"
              >
                Return to sign in
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
