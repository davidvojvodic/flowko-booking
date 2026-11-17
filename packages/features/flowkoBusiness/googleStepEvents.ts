// Flowko U30: the pure builder of a salon booking's Google step events. A worker who has connected Google gets one
// event per busy step of her salon appointments: a deterministic id (derived from the booking, never the booking's
// link), a short title (service, first name and the initial of the last name), and a description with the business,
// the visit and a link to the desk. No guests, no phone number, no cancel link, no booking uid in any text.
// No imports of Google or the database: googleStepSync.ts does the calls. Server only.
import { createHash } from "node:crypto";

export type StepCopy = {
  index: number;
  kind: "busy" | "processing";
  startTime: Date;
  endTime: Date;
  serviceName: string;
};

export type StepEvent = {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  visibility: "private";
  transparency: "opaque";
  reminders: { useDefault: true };
};

/** R1: "fs" + the SHA-256 of the booking uid and the step index in hex (base32hex-legal, 66 characters). */
export function stepEventId(bookingUid: string, stepIndex: number): string {
  return `fs${createHash("sha256").update(`${bookingUid}:${stepIndex}`).digest("hex")}`;
}

/** R10: one word as is; several: the first word, then the upper-cased first character of the last word and a dot. */
export function shortCustomerName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return "Stranka";
  if (words.length === 1) return words[0];
  const [initial] = Array.from(words[words.length - 1]);
  return `${words[0]} ${initial.toLocaleUpperCase("sl")}.`;
}

/** The events Google should hold: busy steps only (a processing step leaves the gap free), in index order. */
export function stepEventsFor(input: {
  uid: string;
  businessName: string;
  timeZone: string;
  customerName: string;
  steps: StepCopy[];
  deskUrl: string;
}): StepEvent[] {
  const ordered = [...input.steps].sort((a, b) => a.index - b.index);
  const busy = ordered.filter((step) => step.kind === "busy");
  const services = Array.from(new Set(ordered.map((step) => step.serviceName))).join(" + ");
  const who = shortCustomerName(input.customerName);
  return busy.map((step, position) => {
    const part = busy.length > 1 ? ` — ${position + 1}. del od ${busy.length}` : "";
    return {
      id: stepEventId(input.uid, step.index),
      summary: `${step.serviceName} – ${who}`,
      description: `${input.businessName}\nObisk: ${services}${part}\nTermin uredite v Flowku: ${input.deskUrl}`,
      start: { dateTime: step.startTime.toISOString(), timeZone: input.timeZone },
      end: { dateTime: step.endTime.toISOString(), timeZone: input.timeZone },
      visibility: "private",
      transparency: "opaque",
      reminders: { useDefault: true },
    };
  });
}

/** Every step's id, processing included: what a delete removes. */
export function allStepEventIds(uid: string, steps: Pick<StepCopy, "index">[]): string[] {
  return steps.map((step) => stepEventId(uid, step.index));
}
