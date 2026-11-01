"use client";

import { captureException } from "@sentry/nextjs";
import React from "react";

import { getErrorFromUnknown } from "@calcom/lib/errors";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { redactError } from "@calcom/lib/redactError";

import { ErrorPage } from "@components/error/error-page";

import "../styles/flowko-theme.css";

const log = logger.getSubLogger({ prefix: ["[error]"] });

export type ErrorProps = {
  error: Error;
  reset?: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  // Flowko: outside an i18n provider (global-error.tsx) t() falls back to the English default.
  const { t } = useLocale();
  React.useEffect(() => {
    log.error(error);

    // Log the error to Sentry
    captureException(error);
  }, [error]);

  const processedError = React.useMemo(() => {
    const err = getErrorFromUnknown(error);

    if (err instanceof HttpError) {
      const redactedError = redactError(err);
      return {
        statusCode: err.statusCode,
        title: redactedError.name,
        name: redactedError.name,
        message: redactedError.message,
        url: err.url,
        method: err.method,
        cause: err.cause,
      };
    }

    return {
      statusCode: 500,
      title: t("internal_server_error", { defaultValue: "Internal Server Error" }),
      name: t("internal_server_error", { defaultValue: "Internal Server Error" }),
      message: t("unexpected_error_occurred", { defaultValue: "An unexpected error occurred." }),
    };
  }, [error, t]);

  return (
    <ErrorPage
      reset={reset}
      statusCode={processedError.statusCode}
      error={processedError}
      message={processedError.message}
    />
  );
}
