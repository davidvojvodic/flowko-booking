// Flowko U29d: the HTML of the invite mail (E1). The same content as the plain text of `FlowkoInviteEmail`; no logo,
// no remote font. Names go through `t()` with escaping off: React escapes them once.
import type { TFunction } from "i18next";

import { BaseEmailHtml, CallToAction, getEmailLang } from "../components";

export type FlowkoInviteProps = {
  language: TFunction;
  name: string;
  businessName: string;
  /** null: the reply line is left out (there is no Reply-To). */
  replyTo: string | null;
  link: string;
  expiresDate: string;
  expiresTime: string;
};

const RAW = { interpolation: { escapeValue: false } } as const;
const paragraph = { fontWeight: 400, lineHeight: "24px" } as const;

export const FlowkoInviteEmail = (
  props: FlowkoInviteProps & Partial<React.ComponentProps<typeof BaseEmailHtml>>
) => {
  const t = props.language;
  return (
    <BaseEmailHtml
      lang={getEmailLang(t)}
      subject={t("flowko_invite_mail_subject", { businessName: props.businessName, ...RAW })}
    >
      <p>
        <>{t("hi_user_name", { name: props.name, ...RAW })}!</>
      </p>
      <p style={paragraph}>
        <>{t("flowko_invite_mail_intro", { businessName: props.businessName, ...RAW })}</>
      </p>
      <CallToAction label={t("flowko_invite_mail_cta")} href={props.link} />
      <p style={paragraph}>
        <>{t("flowko_invite_mail_link_text", { link: props.link, ...RAW })}</>
      </p>
      <p style={paragraph}>
        <>{t("flowko_invite_mail_expiry", { date: props.expiresDate, time: props.expiresTime, ...RAW })}</>
      </p>
      <p style={paragraph}>
        <>{t("flowko_invite_mail_ignore")}</>
      </p>
      {props.replyTo ? (
        <p style={paragraph}>
          <>{t("flowko_invite_mail_reply")}</>
        </p>
      ) : null}
    </BaseEmailHtml>
  );
};
