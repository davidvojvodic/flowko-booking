// Flowko U29e: the HTML of the business notice on a customer cancel (E7, R13). The same content as the plain text of
// `FlowkoCancelNoticeEmail`; no logo, no remote font. Names and the reason go through `t()` with escaping off or
// straight into JSX: React escapes them once. A reason over several lines keeps its lines.
import type { TFunction } from "i18next";
import { Fragment } from "react";

import { BaseEmailHtml, CallToAction, getEmailLang } from "../components";

export type FlowkoCancelNoticeProps = {
  language: TFunction;
  subject: string;
  replyTo: string | null;
  customerName: string;
  customerPhone: string | null;
  serviceNames: string[];
  workerName: string;
  date: string;
  start: string;
  end: string;
  reason: string | null;
  dayUrl: string;
  ownerFallback: boolean;
};

const RAW = { interpolation: { escapeValue: false } } as const;
const paragraph = { fontWeight: 400, lineHeight: "24px" } as const;
const label = { fontWeight: 600 } as const;

const Line = (props: { label: string; children: React.ReactNode }) => (
  <p style={paragraph}>
    <span style={label}>{props.label}:</span> {props.children}
  </p>
);

export const FlowkoCancelNoticeEmail = (
  props: FlowkoCancelNoticeProps & Partial<React.ComponentProps<typeof BaseEmailHtml>>
) => {
  const t = props.language;
  const reasonLines = props.reason === null ? [] : props.reason.split("\n");
  return (
    <BaseEmailHtml lang={getEmailLang(t)} subject={props.subject}>
      <p>
        <strong>{t("flowko_cancel_notice_heading")}</strong>
      </p>
      <Line label={t("flowko_cancel_notice_customer")}>{props.customerName}</Line>
      {props.customerPhone ? (
        <Line label={t("flowko_cancel_notice_phone")}>{props.customerPhone}</Line>
      ) : null}
      <Line label={t("flowko_cancel_notice_services")}>{props.serviceNames.join(", ")}</Line>
      <Line label={t("flowko_cancel_notice_worker")}>{props.workerName}</Line>
      <Line label={t("flowko_cancel_notice_when")}>
        {t("flowko_cancel_notice_when_value", {
          date: props.date,
          start: props.start,
          end: props.end,
          ...RAW,
        })}
      </Line>
      {props.reason !== null ? (
        <Line label={t("flowko_cancel_notice_reason")}>
          {reasonLines.map((text, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one fixed text, never reordered
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              {text}
            </Fragment>
          ))}
        </Line>
      ) : (
        <p style={paragraph}>{t("flowko_cancel_notice_no_reason")}</p>
      )}
      <CallToAction label={t("flowko_cancel_notice_open_day")} href={props.dayUrl} />
      {props.replyTo ? <p style={paragraph}>{t("flowko_cancel_notice_reply_hint")}</p> : null}
      <p style={paragraph}>{t("flowko_cancel_notice_footer")}</p>
      {props.ownerFallback ? <p style={paragraph}>{t("flowko_cancel_notice_footer_fallback")}</p> : null}
    </BaseEmailHtml>
  );
};
