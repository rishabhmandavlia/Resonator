import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

type StatusToastTone = "success" | "error";

export function StatusToast({
  tone,
  message,
  onClose,
  durationMs = 10000,
}: {
  tone: StatusToastTone;
  message: string;
  onClose: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    const timerId = window.setTimeout(onClose, durationMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [durationMs, onClose, tone, message]);

  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  const toneClassName =
    tone === "success"
      ? {
          container: "border-emerald-200 bg-white/95",
          icon: "bg-emerald-50 text-emerald-600",
        }
      : {
          container: "border-red-200 bg-white/95",
          icon: "bg-red-50 text-red-600",
        };

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 sm:bottom-6 sm:left-6">
      <div
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={`pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur ${toneClassName.container}`}
        role={tone === "error" ? "alert" : "status"}
      >
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toneClassName.icon}`}
        >
          <Icon className="h-4 w-4" />
        </div>

        <p className="min-w-0 flex-1 text-sm leading-6 text-slate-700">
          {message}
        </p>

        <button
          type="button"
          aria-label="Dismiss notification"
          className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}