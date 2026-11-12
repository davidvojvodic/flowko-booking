"use client";

// Flowko U29d (A5, A7): the invitee's form on /auth/pridruzi/<token>. Slovene only; phone-safe (AuthContainer). The
// e-mail is fixed (read-only, the owner typed it; „E-poštnega naslova ni mogoče spremeniti. Če ni pravi, se
// obrnite na salon.“ under it), the name is prefilled and editable (1..80), the password shows Cal's live hints
// (caplow / min / num; at most 72 UTF-8 bytes, bcrypt reads no more) and is repeated. The heading and the privacy
// line are translated on the server (escapeValue false, React escapes; never through ServerTrans, which would parse
// tags in a salon name). Submit posts
// {token, name, password, csrfToken} to /api/flowko/pridruzi; on 201 the credentials provider signs in and a full
// load opens /koledar (U14). If that sign-in fails the account exists and the invite is used: the page says so and
// links to the login, it never posts the token again. Every answer and every fetch failure is shown in Slovene,
// never as a raw message or a toast; a fresh CSRF token is fetched on mount and after every failed POST (the
// route deletes the cookie once it has checked it).
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { isPasswordValid } from "@calcom/lib/auth/isPasswordValid";
import { WEBAPP_URL, WEBSITE_PRIVACY_POLICY_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { Input, Label, PasswordField, TextField } from "@calcom/ui/components/form";

import AuthContainer from "@components/ui/AuthContainer";

import { InviteInvalid } from "./InviteInvalid";

export type AcceptViewProps = {
  token: string;
  email: string;
  /** The name the owner typed (or the desk-only member's label), prefilled and editable. */
  name: string;
  /** „Pridružite se salonu <name>“, translated on the server. */
  title: string;
  /** The privacy sentence with the salon's name, translated on the server; the link follows it. */
  privacy: string;
};

type FormValues = { name: string; password: string; confirm_password: string };

const NAME_MAX = 80;
const PASSWORD_MAX_BYTES = 72;
const CALLBACK_URL = `${WEBAPP_URL}/koledar`;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/** The `code` of an error answer, or null when the body is not the JSON the route writes. */
async function answerCode(res: { json: () => Promise<unknown> }): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return body && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

type FormError = { key: string; contactSalon?: boolean };

export default function AcceptView({ token, email, name, title, privacy }: AcceptViewProps) {
  const { t } = useLocale();
  const emailId = useId();
  const [stage, setStage] = useState<"form" | "invalid" | "created">("form");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // UI-3: the server HTML's submit stays disabled until hydration, so a tap or Enter before it never submits natively.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const busy = useRef(false);
  const csrf = useRef("");
  const [csrfRound, refreshCsrf] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let live = true;
    fetch("/api/csrf", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { csrfToken?: unknown }) => {
        if (live) csrf.current = typeof body?.csrfToken === "string" ? body.csrfToken : "";
      })
      .catch(() => {
        if (live) csrf.current = "";
      });
    return () => {
      live = false;
    };
  }, [csrfRound]);

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().refine((value) => {
            const length = value.trim().length;
            return length >= 1 && length <= NAME_MAX;
          }, t("flowko_workers_error_bad_name")),
          // Cal's signup pattern: one issue per unmet hint, keyed by the hint, so the hints turn red / green.
          password: z.string().superRefine((value, ctx) => {
            const result = isPasswordValid(value, true);
            for (const [key, met] of Object.entries(result)) {
              if (!met) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: key });
            }
          }),
          confirm_password: z.string(),
        })
        .superRefine((values, ctx) => {
          if (values.confirm_password !== values.password) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["confirm_password"],
              message: t("error_password_mismatch"),
            });
          }
        }),
    [t]
  );

  const form = useForm<FormValues>({
    mode: "onChange",
    resolver: zodResolver(schema),
    defaultValues: { name, password: "", confirm_password: "" },
  });

  const signInAndGo = async (password: string) => {
    try {
      const result = await signIn("credentials", {
        email,
        password,
        callbackUrl: CALLBACK_URL,
        redirect: false,
      });
      if (result && !result.error) {
        setLeaving(true);
        // Flowko U14: a full load, so the root layout renders in the account's language.
        window.location.assign(CALLBACK_URL);
        return;
      }
    } catch {
      // the account exists and the invite is used: never post the token again
    }
    setStage("created");
  };

  const onSubmit = async (values: FormValues) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setFormError(null);
      setPasswordError(null);
      if (utf8Bytes(values.password) > PASSWORD_MAX_BYTES) {
        setPasswordError(t("flowko_invite_accept_password_too_long"));
        return;
      }
      let res: Response;
      try {
        res = await fetch("/api/flowko/pridruzi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            name: values.name,
            password: values.password,
            csrfToken: csrf.current,
          }),
        });
      } catch {
        refreshCsrf();
        setFormError({ key: "something_went_wrong" });
        return;
      }
      if (res.status === 201) {
        await signInAndGo(values.password);
        return;
      }
      refreshCsrf();
      const code = await answerCode(res);
      if (res.status === 429) {
        setFormError({ key: "flowko_settings_error_TOO_MANY_REQUESTS" });
      } else if (code === "invite_invalid") {
        setStage("invalid");
      } else if (code === "email_has_login") {
        setFormError({ key: "flowko_invite_error_email_has_login", contactSalon: true });
      } else if (code === "member_name_taken") {
        form.setError("name", { type: "server", message: t("flowko_invite_accept_name_taken") });
      } else if (code === "bad_member") {
        form.setError("name", { type: "server", message: t("flowko_workers_error_bad_name") });
      } else if (code === "password_requirements_error") {
        setPasswordError(t("password_requirements_error"));
      } else if (code === "password_too_long") {
        setPasswordError(t("flowko_invite_accept_password_too_long"));
      } else if (code === "member_conflict") {
        setFormError({ key: "flowko_workers_error_member_conflict" });
      } else {
        setFormError({ key: "something_went_wrong" });
      }
    } finally {
      busy.current = false;
    }
  };

  if (stage === "invalid") return <InviteInvalid />;

  if (stage === "created") {
    return (
      <AuthContainer showLogo heading={title}>
        <div className="stack-y-6">
          <p className="text-default text-sm" role="status">
            {t("flowko_invite_accept_created")}
          </p>
          <Button href="/auth/login" color="primary" className="w-full justify-center">
            {t("login")}
          </Button>
        </div>
      </AuthContainer>
    );
  }

  const submitting = form.formState.isSubmitting || leaving;

  return (
    <AuthContainer showLogo heading={title}>
      <FormProvider {...form}>
        <form
          className="stack-y-6"
          // UI-3: never a native GET (the password would land in the URL, the history and the edge log).
          method="post"
          noValidate
          data-testid="flowko-invite-accept-form"
          onSubmit={(event) => {
            void form
              .handleSubmit(onSubmit)(event)
              .catch(() => {
                setFormError({ key: "something_went_wrong" });
              });
          }}>
          <div>
            <Label htmlFor={emailId}>{t("email")}</Label>
            <Input id={emailId} type="email" value={email} readOnly autoComplete="username" />
            <p className="text-subtle mt-1 text-sm" data-testid="flowko-invite-email-hint">
              {t("flowko_invite_accept_email_hint")}
            </p>
          </div>
          <TextField
            {...form.register("name")}
            label={t("flowko_workers_add_name")}
            maxLength={NAME_MAX}
            autoComplete="name"
          />
          <div>
            <PasswordField
              {...form.register("password", { onChange: () => setPasswordError(null) })}
              label={t("password")}
              hintErrors={["caplow", "min", "num"]}
              autoComplete="new-password"
            />
            {passwordError ? (
              <p className="text-error mt-2 text-sm" role="alert" data-testid="flowko-invite-password-error">
                {passwordError}
              </p>
            ) : null}
          </div>
          <PasswordField
            {...form.register("confirm_password")}
            label={t("confirm_password")}
            autoComplete="new-password"
          />
          <p className="text-subtle text-sm" data-testid="flowko-invite-privacy">
            {privacy}{" "}
            <Link
              href={WEBSITE_PRIVACY_POLICY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emphasis underline">
              {t("flowko_invite_accept_privacy_link")}
            </Link>
          </p>
          {formError ? (
            <p className="text-error text-sm" role="alert" data-testid="flowko-invite-accept-error">
              {t(formError.key)}
              {formError.contactSalon ? ` ${t("flowko_invite_accept_contact_salon")}` : null}
            </p>
          ) : null}
          <Button
            type="submit"
            color="primary"
            loading={submitting}
            disabled={!mounted || submitting}
            className="w-full justify-center">
            {t("flowko_invite_accept_submit")}
          </Button>
        </form>
      </FormProvider>
    </AuthContainer>
  );
}
