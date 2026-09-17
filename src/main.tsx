import React, { StrictMode, ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: ErrorBoundaryProps;
  declare state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[MENAREPS 2.0] Uncaught React Error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white p-8 flex flex-col items-center justify-center font-sans">
          <div className="max-w-xl w-full bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-400">
              <svg className="w-8 h-8 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h1 className="text-xl font-bold">MENAREPS 2.0 Application Exception</h1>
            </div>
            <p className="text-slate-300 text-sm">
              An unexpected runtime error occurred during application rendering. Details below:
            </p>
            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs text-red-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
              {this.state.error?.toString() || "Unknown Error"}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Reload MENAREPS Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Gracefully handle specific dev-environment Vite HMR WebSocket handshake drop rejections
if (import.meta.env.DEV) {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (
      reason && 
      (reason.message === "WebSocket closed without opened" || 
       String(reason).includes("WebSocket closed without opened"))
    ) {
      console.warn(
        "[Vite HMR Diagnostic] Caught sandbox-specific HMR WebSocket connection drop. " +
        "This is a known development-environment proxy limitation and has been safely intercepted without affecting application execution."
      );
      event.preventDefault();
    }
  });
}

// Print truthful build identity values when the build pipeline injects them.
const buildIdentity = {
  appVersion: "2.0.0",
  buildTimestamp: import.meta.env.VITE_BUILD_TIMESTAMP || "not-injected",
  gitCommit: import.meta.env.VITE_GIT_COMMIT || "not-injected",
  cloudRunRevision: import.meta.env.VITE_CLOUD_RUN_REVISION || "not-injected",
  firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "not-injected",
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "(default)"
};
console.log("[MENAREPS_BUILD_IDENTITY_JSON]", JSON.stringify(buildIdentity, null, 2));
void fetch("/api/runtime-identity", { cache: "no-store" }).then(async response => {
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const runtimeIdentity = await response.json();
  console.log("[MENAREPS_RUNTIME_IDENTITY_JSON]", JSON.stringify(runtimeIdentity, null, 2));
  if (buildIdentity.gitCommit !== "not-injected" && runtimeIdentity.gitCommit !== buildIdentity.gitCommit) {
    console.error("[MENAREPS_BUILD_RUNTIME_IDENTITY_MISMATCH]", JSON.stringify({ frontendGitCommit: buildIdentity.gitCommit, runtimeGitCommit: runtimeIdentity.gitCommit, releaseId: runtimeIdentity.releaseId }));
  }
}).catch(error => console.error("[MENAREPS_RUNTIME_IDENTITY_FAILED]", error));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
