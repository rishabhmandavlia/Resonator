import type { ReactNode } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./services/auth";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ResetPassword } from "./pages/ResetPassword";
import { Layout } from "./components/Layout";

function AnimatedResonatorMark() {
  const gradientId = "auth-splash-res-gradient";

  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      <div className="auth-splash-glow absolute inset-4 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="auth-splash-shell absolute inset-0 rounded-full border border-emerald-200/70 bg-white/85 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-sm" />
      <svg
        viewBox="0 0 120 120"
        aria-hidden="true"
        className="relative z-10 h-28 w-28 overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1F8A70" />
            <stop offset="100%" stopColor="#76D38F" />
          </linearGradient>
        </defs>

        <g transform="translate(60 60)">
          <g>
            <circle
              r="42"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="20 12"
            >
              <animateTransform
                attributeName="transform"
                type="scale"
                values="1;1.05;1"
                dur="2.8s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-dashoffset"
                values="0;-128"
                dur="3.6s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-opacity"
                values="0.92;0.42;0.92"
                dur="2.8s"
                repeatCount="indefinite"
              />
            </circle>
          </g>

          <g>
            <circle
              r="30"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="16 10"
            >
              <animateTransform
                attributeName="transform"
                type="scale"
                values="1;1.07;1"
                dur="2.4s"
                begin="0.15s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-dashoffset"
                values="0;104"
                dur="3s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-opacity"
                values="1;0.48;1"
                dur="2.4s"
                begin="0.15s"
                repeatCount="indefinite"
              />
            </circle>
          </g>

          <g>
            <circle
              r="18"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="10 7"
            >
              <animateTransform
                attributeName="transform"
                type="scale"
                values="1;1.1;1"
                dur="1.9s"
                begin="0.25s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-dashoffset"
                values="0;-68"
                dur="2.2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-opacity"
                values="1;0.56;1"
                dur="1.9s"
                begin="0.25s"
                repeatCount="indefinite"
              />
            </circle>
          </g>

          <circle r="6" fill={`url(#${gradientId})`}>
            <animate
              attributeName="r"
              values="6;7.8;6"
              dur="1.8s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="1;0.78;1"
              dur="1.8s"
              repeatCount="indefinite"
            />
          </circle>

          <g>
            <circle cx="42" cy="0" r="3.6" fill={`url(#${gradientId})`}>
              <animate
                attributeName="opacity"
                values="1;0.65;1"
                dur="1.6s"
                repeatCount="indefinite"
              />
            </circle>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 0 0"
              to="360 0 0"
              dur="3.2s"
              repeatCount="indefinite"
            />
          </g>

          <g opacity="0.55">
            <circle cx="-30" cy="0" r="2.6" fill={`url(#${gradientId})`}>
              <animate
                attributeName="opacity"
                values="0.45;0.95;0.45"
                dur="1.8s"
                repeatCount="indefinite"
              />
            </circle>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="360 0 0"
              to="0 0 0"
              dur="4.6s"
              repeatCount="indefinite"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}

function AuthSplash() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(123,220,147,0.18),_transparent_32%),linear-gradient(180deg,#fbfdfc_0%,#eef6f1_52%,#ffffff_100%)] px-6">
      <style>{`
        @keyframes authSplashGlow {
          0%, 100% { opacity: 0.55; transform: scale(0.96); }
          50% { opacity: 0.95; transform: scale(1.08); }
        }

        @keyframes authSplashShellFloat {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-4px) scale(1.012); }
        }

        .auth-splash-glow {
          animation: authSplashGlow 2.8s ease-in-out infinite;
        }

        .auth-splash-shell {
          animation: authSplashShellFloat 3.4s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .auth-splash-glow,
          .auth-splash-shell {
            animation: none !important;
          }
        }
      `}</style>

      <div className="absolute left-[-8rem] top-[-6rem] h-72 w-72 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="absolute bottom-[-7rem] right-[-4rem] h-80 w-80 rounded-full bg-teal-100/70 blur-3xl" />

      <div className="relative flex max-w-md flex-col items-center text-center">
        <AnimatedResonatorMark />

        <div className="mt-8 space-y-3">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
              Resonator
            </h2>
            <p className="mt-2 text-xs uppercase tracking-[0.28em] text-emerald-700/75">
              AI Text-to-Speech Generator
            </p>
          </div>

          <p className="text-sm leading-6 text-slate-600">
            Initializing System...
          </p>

          <div className="flex items-center justify-center gap-2 text-xs font-medium tracking-[0.16em] text-slate-500 uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Loading workspace
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Protected Layout Route
 * Redirects to login if not authenticated
 */
function ProtectedLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <AuthSplash />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Layout />;
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  const isOAuthLinkVerificationRoute =
    location.pathname === "/register" &&
    new URLSearchParams(location.search).get("mode") === "oauth-link";

  if (isLoading) {
    return <AuthSplash />;
  }

  if (isAuthenticated && !isOAuthLinkVerificationRoute) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <Register />
              </PublicOnlyRoute>
            }
          />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
