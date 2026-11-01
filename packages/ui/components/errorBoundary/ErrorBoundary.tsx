import type { ErrorInfo } from "react";
import React from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";

// Flowko: a class component cannot use the locale hook, so the default message is a small function component.
function DefaultErrorMessage() {
  const { t } = useLocale();
  return <>{t("something_went_wrong")}</>;
}

// Flowko U14: notFound(), forbidden() and redirect() reach a client boundary as errors with these digests. Next 16's
// not-found digest is NEXT_HTTP_ERROR_FALLBACK;404; NEXT_NOT_FOUND is the older name.
const isNextControlFlowError = (error: Error | null) => {
  const digest = error && "digest" in error ? error.digest : undefined;
  return (
    typeof digest === "string" &&
    (digest === "NEXT_NOT_FOUND" ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;") ||
      digest.startsWith("NEXT_REDIRECT"))
  );
};

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; message?: string },
  { error: Error | null; errorInfo: ErrorInfo | null }
> {
  constructor(props: { children: React.ReactNode } | Readonly<{ children: React.ReactNode }>) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch?(error: Error, errorInfo: ErrorInfo) {
    // Catch errors in any components below and re-render with error message
    this.setState({ error, errorInfo });
    // You can also log error messages to an error reporting service here
  }

  render() {
    // do not intercept Next's own errors: passing them up lets not-found.tsx or the redirect handle them
    if (isNextControlFlowError(this.state.error)) {
      throw this.state.error;
    }

    if (this.state.errorInfo) {
      // Error path
      return (
        <div>
          <h2>{this.props.message || <DefaultErrorMessage />}</h2>
          <details style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error && this.state.error.toString()}
          </details>
        </div>
      );
    }
    // Normally, just render children
    return this.props.children;
  }
}

export default ErrorBoundary;
