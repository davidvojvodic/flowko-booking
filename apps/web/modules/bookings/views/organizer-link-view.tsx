"use client";

import { Button, buttonClasses } from "@calcom/ui/components/button";
import { Label, TextArea } from "@calcom/ui/components/form";
import AuthContainer from "@calcom/web/components/ui/AuthContainer";
import { useEffect, useId, useState } from "react";

/**
 * Flowko (U8f): the confirm page an organizer's e-mailed accept/reject link opens (`/booking/link`). It shows
 * what will happen and changes nothing itself: only its button POSTs the token back to `/api/link`, which
 * decides. Every text arrives translated from the server page, in the organizer's language.
 */
export type OrganizerLinkViewProps = {
  /** The language of the texts, set as `lang` on the page's content. */
  lang: string;
  heading: string;
  description: string;
  /** The booking's title and time, as the request e-mail showed them to the organizer. */
  details?: { whatLabel: string; title: string; whenLabel: string; when: string };
  form?: {
    action: "accept" | "reject";
    token: string;
    submitLabel: string;
    /** Only for a rejection: the optional reason's label. */
    reasonLabel?: string;
    reasonMaxLength?: number;
  };
  /** A way on when there is nothing to decide: the unconfirmed bookings, or the booking itself. */
  link?: { href: string; label: string };
};

function OrganizerLinkForm({
  action,
  token,
  submitLabel,
  reasonLabel,
  reasonMaxLength,
}: NonNullable<OrganizerLinkViewProps["form"]>) {
  const [submitting, setSubmitting] = useState(false);
  const reasonId = useId();

  useEffect(() => {
    // A page restored from the back/forward cache would keep the pressed button; let it work again.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <form
      method="post"
      action="/api/link"
      className="mt-6 space-y-4"
      data-testid="organizer-link-form"
      onSubmit={(event) => {
        // One decision per press: a second submit while the first is on its way is dropped.
        if (submitting) {
          event.preventDefault();
          return;
        }
        setSubmitting(true);
      }}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="action" value={action} />
      {reasonLabel ? (
        <div>
          <Label htmlFor={reasonId}>{reasonLabel}</Label>
          <TextArea id={reasonId} name="reason" rows={3} maxLength={reasonMaxLength} />
        </div>
      ) : null}
      <Button
        type="submit"
        color={action === "reject" ? "destructive" : "primary"}
        loading={submitting}
        className="w-full justify-center"
        data-testid="organizer-link-submit">
        {submitLabel}
      </Button>
    </form>
  );
}

export default function OrganizerLinkView({
  lang,
  heading,
  description,
  details,
  form,
  link,
}: OrganizerLinkViewProps) {
  return (
    <div lang={lang}>
      <AuthContainer showLogo>
        <div data-testid="organizer-link-page">
          <h1 className="text-emphasis text-lg font-semibold leading-6">{heading}</h1>
          <p className="text-default mt-2 text-sm">{description}</p>
          {details ? (
            <dl className="border-subtle text-default mt-6 grid grid-cols-3 gap-y-3 border-t pt-6 text-sm">
              <dt className="text-emphasis font-medium">{details.whatLabel}</dt>
              <dd className="col-span-2 break-words" data-testid="organizer-link-title">
                {details.title}
              </dd>
              <dt className="text-emphasis font-medium">{details.whenLabel}</dt>
              <dd className="col-span-2" data-testid="organizer-link-when">
                {details.when}
              </dd>
            </dl>
          ) : null}
          {form ? <OrganizerLinkForm {...form} /> : null}
          {link ? (
            // A full page load: the target is another page of the app (sign-in first, for the bookings list)
            <a
              href={link.href}
              className={buttonClasses({ color: "secondary", className: "mt-6 w-full justify-center" })}
              data-testid="organizer-link-next">
              {link.label}
            </a>
          ) : null}
        </div>
      </AuthContainer>
    </div>
  );
}
