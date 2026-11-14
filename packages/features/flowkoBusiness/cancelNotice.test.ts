// Flowko U29e Task 6 (E7, R13): the business notice on a customer cancel, read from the stored booking on prismock.
// Business A: owner Olga (login), worker Bor (login), desk-only worker Cene; Barvanje, Moško and Žensko striženje
// on Bor and Cene; usual weeks Mon–Fri 07–15. Bookings on Mon 23 Nov 2026 10:00 (business-local), cancelled by
// the customer through the link (no session; mails off in the fixture). The mail sender is mocked: these tests
// prove what the service hands it and what it logs; the template is proven in
// packages/emails/flowko-u29e-cancel-notice.test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import { sendFlowkoCancelNoticeEmail } from "@calcom/emails/email-manager";
import { MailTransportError } from "@calcom/emails/templates/_base-email";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { cancelBusinessBookingAsCustomer } from "./bookingChange";
import { sendBusinessCancelNotice } from "./bookingMail";
import { createBusinessBooking } from "./bookingWriter";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { setUsualWeek } from "./roster";

vi.mock("@calcom/emails/email-manager", () => ({
  sendScheduledEmailsAndSMS: vi.fn(async () => undefined),
  sendRescheduledEmailsAndSMS: vi.fn(async () => undefined),
  sendCancelledEmailsAndSMS: vi.fn(async () => undefined),
  sendFlowkoCancelNoticeEmail: vi.fn(async () => "sent"),
}));

const db = prismock as unknown as FlowkoDb;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 16 Nov 08:07 in Ljubljana
const DATE = "2026-11-23"; // a Monday
const at = (time: string) => new Date(wallClockToMs(DATE, time, TZ));
const REASON = "Zbolela sem & ne morem priti.";
let seq = 0;

const notice = vi.mocked(sendFlowkoCancelNoticeEmail);

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

async function makeUser(name: string): Promise<{ id: number; email: string }> {
  seq += 1;
  const email = `${name.toLowerCase()}${seq}@example.com`;
  const user = await prismock.user.create({
    data: { email, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return { id: user.id, email };
}

type Fixture = {
  a: number;
  olga: { id: number; email: string };
  members: { bor: number; cene: number };
  services: Record<"mens" | "womens" | "colouring", number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga.id,
    name: "Salon A",
    slug: `cn-a-${seq}`,
    templateId: "hair-salon",
    address: "Glavna ulica 1, Ljubljana",
  });
  const a = created.businessId;
  await prismock.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [] } });
  const bor = await makeUser("Bor");
  const borMember = await addLoginMember(db, a, bor.id, FlowkoBusinessRole.WORKER);
  const cene = await createDeskOnlyWorker(db, a, "Cene");

  const services = await prismock.flowkoService.findMany({
    where: { businessId: a },
    select: { id: true, name: true },
  });
  const idOf = (name: string) => {
    const s = services.find((x) => x.name === name);
    if (!s) throw new Error(`fixture: service ${name} missing`);
    return s.id;
  };
  const ids = {
    mens: idOf("Moško striženje"),
    womens: idOf("Žensko striženje"),
    colouring: idOf("Barvanje"),
  };
  for (const memberId of [borMember.memberId, cene.memberId]) {
    for (const serviceId of Object.values(ids)) {
      await prismock.flowkoServiceWorker.create({ data: { serviceId, memberId } });
    }
    await setUsualWeek(db, olga.id, {
      memberId,
      usualWeek: week([{ from: "07:00", to: "15:00" }]),
      confirmOutsideOpening: false,
    });
  }
  return { a, olga, members: { bor: borMember.memberId, cene: cene.memberId }, services: ids };
}

/** A booking on Mon 23 Nov at `time`, cancelled by the customer through the link (no session, no mails). */
async function cancelledBooking(over: {
  memberId: number;
  serviceIds: number[];
  customer?: { name: string; email?: string | null; phone?: string | null };
  reason?: string | null;
  time?: string;
}): Promise<number> {
  const result = await createBusinessBooking(
    db,
    f.olga.id,
    {
      workerMemberId: over.memberId,
      serviceIds: over.serviceIds,
      start: at(over.time ?? "10:00"),
      customer: over.customer ?? { name: "Ana & Maja", email: "ana.maja@example.si", phone: "041 123 456" },
      confirmOverride: false,
    },
    NOW,
    {
      lockWorker: async () => undefined,
      googleBusy: async () => ({ busy: [], unavailable: false }),
      sendMails: false,
    }
  );
  if (result.status !== "created")
    throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  await cancelBusinessBookingAsCustomer(
    db,
    { uid: result.uid, reason: over.reason === undefined ? REASON : over.reason, sessionUserId: null },
    NOW,
    { sendMails: false }
  );
  return result.bookingId;
}

let f: Fixture;
type LogFn = (...args: unknown[]) => unknown;
let logWarn: MockInstance<LogFn>;
let logError: MockInstance<LogFn>;
let logInfo: MockInstance<LogFn>;

beforeEach(async () => {
  f = await setUp();
  notice.mockReset();
  notice.mockResolvedValue("sent");
  const proto = Object.getPrototypeOf(logger) as { warn: LogFn; error: LogFn; info: LogFn };
  logWarn = vi.spyOn(proto, "warn").mockImplementation(() => undefined);
  logError = vi.spyOn(proto, "error").mockImplementation(() => undefined);
  logInfo = vi.spyOn(proto, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const noticeLines = () => logWarn.mock.calls.filter((call) => call[0] === "flowko_cancel_notice_not_sent");
const allLogText = () =>
  JSON.stringify([...logWarn.mock.calls, ...logError.mock.calls, ...logInfo.mock.calls]);
const onlyCall = () => {
  expect(notice).toHaveBeenCalledTimes(1);
  return notice.mock.calls[0];
};

describe("sendBusinessCancelNotice: recipient (R13)", () => {
  it("goes to the business e-mail when one is set; no fallback footer", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { email: "salon@salon-a.si" } });
    const bookingId = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });

    await sendBusinessCancelNotice(bookingId);

    const [args, locale] = onlyCall();
    expect(args.to).toBe("salon@salon-a.si");
    expect(args.ownerFallback).toBe(false);
    expect(locale).toBe("sl");
  });

  it("no business e-mail → the OWNER's login e-mail (read through the member relation), with the fallback footer", async () => {
    const business = await prismock.flowkoBusiness.findUnique({
      where: { id: f.a },
      select: { email: true },
    });
    expect(business?.email ?? null).toBeNull();
    const bookingId = await cancelledBooking({ memberId: f.members.bor, serviceIds: [f.services.mens] });

    await sendBusinessCancelNotice(bookingId);

    const [args] = onlyCall();
    expect(args.to).toBe(f.olga.email);
    expect(args.ownerFallback).toBe(true);
  });

  it("Reply-To = the customer's real e-mail; a phone-only customer (…@sms.cal.com) → none", async () => {
    const withMail = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });
    const phoneOnly = await cancelledBooking({
      memberId: f.members.cene,
      serviceIds: [f.services.mens],
      customer: { name: "Marija Novak", phone: "041 999 888" },
      time: "12:00",
    });
    const attendee = await prismock.attendee.findFirst({ where: { bookingId: phoneOnly } });
    expect(attendee?.email.endsWith("@sms.cal.com")).toBe(true);

    await sendBusinessCancelNotice(withMail);
    await sendBusinessCancelNotice(phoneOnly);

    expect(notice.mock.calls[0][0].replyTo).toBe("ana.maja@example.si");
    expect(notice.mock.calls[1][0].replyTo).toBeNull();
    expect(notice.mock.calls[1][0].customerName).toBe("Marija Novak");
    expect(notice.mock.calls[1][0].customerPhone).toBe(attendee?.phoneNumber);
  });
});

describe("sendBusinessCancelNotice: content (R13)", () => {
  it("customer, phone, services in step order, worker, business-local date and times, reason, day link", async () => {
    const bookingId = await cancelledBooking({
      memberId: f.members.cene,
      serviceIds: [f.services.womens, f.services.mens],
    });
    const attendee = await prismock.attendee.findFirst({ where: { bookingId } });

    await sendBusinessCancelNotice(bookingId);

    const [args] = onlyCall();
    expect(args).toEqual({
      to: f.olga.email,
      replyTo: "ana.maja@example.si",
      customerName: "Ana & Maja",
      customerPhone: attendee?.phoneNumber ?? null,
      serviceNames: ["Žensko striženje", "Moško striženje"],
      workerName: "Cene",
      date: "pon., 23. 11. 2026",
      start: "10:00",
      end: "11:15",
      reason: REASON,
      dayUrl: `${WEBAPP_URL}/koledar?view=day&date=2026-11-23`,
      ownerFallback: true,
    });
    expect(attendee?.phoneNumber).toBeTruthy();
  });

  it("services are distinct (Barvanje's three steps once), in step order", async () => {
    const bookingId = await cancelledBooking({
      memberId: f.members.cene,
      serviceIds: [f.services.colouring, f.services.mens],
    });
    const steps = await prismock.flowkoBookingStep.findMany({
      where: { bookingId },
      orderBy: { index: "asc" },
    });
    expect(steps.map((s) => s.serviceName)).toEqual(["Barvanje", "Barvanje", "Barvanje", "Moško striženje"]);

    await sendBusinessCancelNotice(bookingId);

    expect(onlyCall()[0].serviceNames).toEqual(["Barvanje", "Moško striženje"]);
    expect(onlyCall()[0].end).toBe("12:10");
  });

  it("the worker is the member's current displayName (a rename after the booking shows)", async () => {
    const bookingId = await cancelledBooking({ memberId: f.members.bor, serviceIds: [f.services.mens] });
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.bor },
      data: { displayName: "Bor B." },
    });

    await sendBusinessCancelNotice(bookingId);

    expect(onlyCall()[0].workerName).toBe("Bor B.");
  });

  it("no reason stored → reason null; no phone → customerPhone null", async () => {
    const bookingId = await cancelledBooking({
      memberId: f.members.cene,
      serviceIds: [f.services.mens],
      customer: { name: "Tina Rep", email: "tina@example.com" },
      reason: null,
    });

    await sendBusinessCancelNotice(bookingId);

    const [args] = onlyCall();
    expect(args.reason).toBeNull();
    expect(args.customerPhone).toBeNull();
    expect(args.replyTo).toBe("tina@example.com");
  });

  it("DST: a booking on Sun 28 Mar 2027 10:00 local (08:00 UTC, CEST) reads 10:00–11:15 on ned., 28. 3. 2027", async () => {
    const bookingId = await cancelledBooking({
      memberId: f.members.cene,
      serviceIds: [f.services.womens, f.services.mens],
    });
    await prismock.booking.update({
      where: { id: bookingId },
      data: { startTime: new Date("2027-03-28T08:00:00Z"), endTime: new Date("2027-03-28T09:15:00Z") },
    });

    await sendBusinessCancelNotice(bookingId);

    const [args] = onlyCall();
    expect(args.date).toBe("ned., 28. 3. 2027");
    expect(args.start).toBe("10:00");
    expect(args.end).toBe("11:15");
    expect(args.dayUrl).toBe(`${WEBAPP_URL}/koledar?view=day&date=2027-03-28`);
  });
});

describe("sendBusinessCancelNotice: outcomes and logging (mail rule)", () => {
  it("sent → no log line", async () => {
    const bookingId = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });

    await sendBusinessCancelNotice(bookingId);

    expect(notice).toHaveBeenCalledTimes(1);
    expect(logWarn).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([
    "skipped_kill_switch",
    "skipped_faux",
    "skipped_test_mode",
    "skipped_locked",
  ] as const)("%s → one flowko_cancel_notice_not_sent line { bookingId, outcome }", async (outcome) => {
    const bookingId = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });
    notice.mockResolvedValueOnce(outcome);

    await expect(sendBusinessCancelNotice(bookingId)).resolves.toBeUndefined();

    expect(noticeLines()).toEqual([["flowko_cancel_notice_not_sent", { bookingId, outcome }]]);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it("a MailTransportError → resolves, one line { bookingId, error: MailTransportError }", async () => {
    const bookingId = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });
    notice.mockRejectedValueOnce(new MailTransportError(new Error("smtp down for salon@salon-a.si")));

    await expect(sendBusinessCancelNotice(bookingId)).resolves.toBeUndefined();

    expect(noticeLines()).toEqual([
      ["flowko_cancel_notice_not_sent", { bookingId, error: "MailTransportError" }],
    ]);
  });

  it("a failing read → resolves, nothing sent, one line { bookingId, error }", async () => {
    const bookingId = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });
    vi.spyOn(prismock.booking, "findUnique").mockRejectedValueOnce(new TypeError("db down"));

    await expect(sendBusinessCancelNotice(bookingId)).resolves.toBeUndefined();

    expect(notice).not.toHaveBeenCalled();
    expect(noticeLines()).toEqual([["flowko_cancel_notice_not_sent", { bookingId, error: "TypeError" }]]);
  });

  it("a booking that is not cancelled → nothing sent, one line { bookingId, outcome: not_cancelled }", async () => {
    const result = await createBusinessBooking(
      db,
      f.olga.id,
      {
        workerMemberId: f.members.cene,
        serviceIds: [f.services.mens],
        start: at("13:00"),
        customer: { name: "Ana & Maja", email: "ana.maja@example.si" },
        confirmOverride: false,
      },
      NOW,
      {
        lockWorker: async () => undefined,
        googleBusy: async () => ({ busy: [], unavailable: false }),
        sendMails: false,
      }
    );
    if (result.status !== "created") throw new Error("fixture");

    await sendBusinessCancelNotice(result.bookingId);

    expect(notice).not.toHaveBeenCalled();
    expect(noticeLines()).toEqual([
      ["flowko_cancel_notice_not_sent", { bookingId: result.bookingId, outcome: "not_cancelled" }],
    ]);
  });

  it("no business booking (unknown id, a plain Cal booking) → nothing sent, outcome not_business_booking", async () => {
    const plainType = await prismock.eventType.create({
      data: {
        title: "Olgin posvet",
        slug: `posvet-${seq}`,
        length: 30,
        owner: { connect: { id: f.olga.id } },
      },
      select: { id: true },
    });
    const plain = await prismock.booking.create({
      data: {
        uid: `plain-${seq}`,
        title: "Posvet",
        startTime: at("12:00"),
        endTime: at("12:30"),
        status: BookingStatus.CANCELLED,
        user: { connect: { id: f.olga.id } },
        eventType: { connect: { id: plainType.id } },
      },
      select: { id: true },
    });

    await sendBusinessCancelNotice(plain.id);
    await sendBusinessCancelNotice(999_999);

    expect(notice).not.toHaveBeenCalled();
    expect(noticeLines()).toEqual([
      ["flowko_cancel_notice_not_sent", { bookingId: plain.id, outcome: "not_business_booking" }],
      ["flowko_cancel_notice_not_sent", { bookingId: 999_999, outcome: "not_business_booking" }],
    ]);
  });

  it("no owner login e-mail and no business e-mail → nothing sent, outcome no_recipient", async () => {
    const bookingId = await cancelledBooking({ memberId: f.members.cene, serviceIds: [f.services.mens] });
    vi.spyOn(prismock.flowkoBusinessMember, "findFirst").mockResolvedValueOnce(null);

    await sendBusinessCancelNotice(bookingId);

    expect(notice).not.toHaveBeenCalled();
    expect(noticeLines()).toEqual([
      ["flowko_cancel_notice_not_sent", { bookingId, outcome: "no_recipient" }],
    ]);
  });

  it("no log line carries an address, a name or the reason (every failure kind)", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { email: "salon@salon-a.si" } });
    const bookingId = await cancelledBooking({ memberId: f.members.bor, serviceIds: [f.services.mens] });
    notice.mockResolvedValueOnce("skipped_locked");
    await sendBusinessCancelNotice(bookingId);
    notice.mockRejectedValueOnce(new MailTransportError(new Error("salon@salon-a.si refused")));
    await sendBusinessCancelNotice(bookingId);
    notice.mockRejectedValueOnce(new Error(`bad ${f.olga.email} Ana & Maja`));
    await sendBusinessCancelNotice(bookingId);

    expect(noticeLines()).toHaveLength(3);
    const text = allLogText();
    for (const secret of [
      "salon@salon-a.si",
      f.olga.email,
      "ana.maja@example.si",
      "Ana & Maja",
      "Ana",
      "Bor",
      "Salon A",
      REASON,
      "Zbolela",
      "Stranka",
      "@",
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
