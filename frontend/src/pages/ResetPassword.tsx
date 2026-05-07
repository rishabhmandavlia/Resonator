import { ArrowLeft, KeyRound, Loader2, Mail } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import resonatorLogo from "../assets/resonator-logo.svg";
import resonatorWordmark from "../assets/resonator-wordmark.svg";
import {
  PasswordValidator,
  validatePassword,
} from "../components/PasswordValidator";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
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
import {
  apiClient,
  type PasswordResetTokenValidationResponse,
} from "../services/api";

type ResetTokenState = "idle" | "loading" | "valid" | "invalid";

export function ResetPassword() {
  const [searchParams, setSearchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<ResetTokenState>(
    token ? "loading" : "idle",
  );
  const [tokenValidation, setTokenValidation] =
    useState<PasswordResetTokenValidationResponse | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  const passwordValidation = useMemo(
    () => validatePassword(newPassword),
    [newPassword],
  );
  const passwordsMatch = newPassword === confirmPassword;
  const isRequestMode = !token || tokenState === "invalid";

  useEffect(() => {
    if (!token) {
      setTokenState("idle");
      setTokenValidation(null);
      return;
    }

    let isCancelled = false;
    setTokenState("loading");
    setFormError(null);
    setRequestMessage(null);
    setSuccessMessage(null);

    const validateToken = async () => {
      try {
        const payload = await apiClient.validatePasswordResetToken(token);
        if (isCancelled) {
          return;
        }

        setTokenValidation(payload);
        setTokenState("valid");
      } catch (err: any) {
        if (isCancelled) {
          return;
        }

        setTokenValidation(null);
        setTokenState("invalid");
        setFormError(
          err?.detail || err?.message || "This password reset link is invalid.",
        );
      }
    };

    void validateToken();

    return () => {
      isCancelled = true;
    };
  }, [token]);

  const handleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    try {
      setIsSubmittingRequest(true);
      const response = await apiClient.requestPasswordReset(email.trim());
      setRequestMessage(response.message);
      setSearchParams({});
    } catch (err: any) {
      setFormError(
        err?.detail || err?.message || "Failed to request password reset",
      );
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleResetSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setRequestMessage(null);

    if (!passwordValidation.valid) {
      setFormError(passwordValidation.errors[0]);
      return;
    }

    if (!passwordsMatch) {
      setFormError("New password confirmation does not match.");
      return;
    }

    try {
      setIsSubmittingReset(true);
      const response = await apiClient.resetPassword(
        token,
        newPassword,
        confirmPassword,
      );
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      setSuccessMessage(response.message);
      setNewPassword("");
      setConfirmPassword("");
      setSearchParams({});
    } catch (err: any) {
      setFormError(err?.detail || err?.message || "Failed to reset password");
    } finally {
      setIsSubmittingReset(false);
    }
  };

  const handleUseNewLink = () => {
    setSearchParams({});
    setTokenValidation(null);
    setTokenState("idle");
    setFormError(null);
    setNewPassword("");
    setConfirmPassword("");
  };

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
                Password Access
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl md:leading-[1.05]">
                {token
                  ? "Set a new password securely."
                  : "Reset password access without support."}
              </h1>
              <p className="text-lg leading-8 text-sky-50/82">
                {token
                  ? "Each reset link is single-use, short-lived, and designed to replace your old password cleanly."
                  : "Request a secure reset link and we’ll email it to the address on your Resonator account if one is available."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/80">
                  Single Use
                </p>
                <p className="mt-2 text-sm leading-6 text-white/82">
                  Reset links are invalidated immediately after a successful
                  password change.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/80">
                  Time Limited
                </p>
                <p className="mt-2 text-sm leading-6 text-white/82">
                  Every reset link expires automatically to reduce replay risk.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-100/80">
                  OAuth Ready
                </p>
                <p className="mt-2 text-sm leading-6 text-white/82">
                  Provider-linked accounts can still set or reset a local
                  password safely.
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
                  {token ? "Reset Password" : "Forgot Password"}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-tight text-slate-900">
                {successMessage
                  ? "Password updated"
                  : token
                    ? "Choose a new password"
                    : "Request a reset link"}
              </CardTitle>
              <CardDescription className="text-sm leading-6 text-slate-600">
                {successMessage
                  ? "Your password has been changed. Use it the next time you sign in."
                  : token && tokenValidation
                    ? `This link is ready for ${tokenValidation.emailHint}.`
                    : "We’ll send a secure reset email if the address matches an eligible account."}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 px-8 pb-8 md:px-10 md:pb-10">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>

            {formError && (
              <Alert className="border-red-200 bg-red-50 text-red-950">
                <AlertTitle>Action needed</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {requestMessage && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <Mail className="h-4 w-4" />
                <AlertTitle>Check your inbox</AlertTitle>
                <AlertDescription>{requestMessage}</AlertDescription>
              </Alert>
            )}

            {successMessage && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <KeyRound className="h-4 w-4" />
                <AlertTitle>Password reset complete</AlertTitle>
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}

            {tokenState === "loading" && (
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating your password reset link...
              </div>
            )}

            {!successMessage && tokenState === "valid" && tokenValidation && (
              <form className="space-y-5" onSubmit={handleResetSubmit}>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  This link expires at{" "}
                  {new Date(tokenValidation.expiresAt).toLocaleString()}.
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-new-password">New password</Label>
                  <Input
                    id="reset-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={isSubmittingReset}
                    placeholder="Create a strong password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirm-password">
                    Confirm new password
                  </Label>
                  <Input
                    id="reset-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isSubmittingReset}
                    placeholder="Confirm your new password"
                  />
                </div>

                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-sm text-red-600">
                    New password confirmation does not match.
                  </p>
                )}

                <PasswordValidator validation={passwordValidation} />

                <Button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-emerald-700 text-white hover:bg-emerald-800"
                  disabled={isSubmittingReset}
                >
                  {isSubmittingReset
                    ? "Updating password..."
                    : "Reset password"}
                </Button>
              </form>
            )}

            {isRequestMode && !successMessage && tokenState !== "loading" && (
              <div className="space-y-5">
                {token && tokenState === "invalid" && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    This link can’t be used anymore. Request a fresh one below.
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleUseNewLink}
                      >
                        Use a new reset link
                      </Button>
                    </div>
                  </div>
                )}

                <form className="space-y-4" onSubmit={handleRequestSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-password-email">Email</Label>
                    <Input
                      id="forgot-password-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={isSubmittingRequest}
                      placeholder="you@example.com"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    disabled={isSubmittingRequest}
                  >
                    {isSubmittingRequest
                      ? "Sending reset link..."
                      : "Send reset link"}
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
