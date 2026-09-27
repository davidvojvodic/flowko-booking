import { afterEach, describe, expect, it, vi } from "vitest";

import { get, post } from "./fetch-wrapper";
import { HttpError } from "./http-error";

// Node's Request has no document to resolve a relative path against, so the tests use absolute URLs
const BOOK_URL = "https://booking.example.com/api/book/event";

const respondWith = (response: Response, url?: string) => {
  if (url !== undefined) Object.defineProperty(response, "url", { value: url });
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const errorOf = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetch-wrapper", () => {
  it("keeps the status, url, method and message of a JSON error answer (the booking form's 429)", async () => {
    const body = { message: "Rate limit exceeded. Try again in 42 seconds." };
    respondWith(new Response(JSON.stringify(body), { status: 429, statusText: "Too Many Requests" }), BOOK_URL);

    const error = await errorOf(post(BOOK_URL, { eventTypeId: 1 }));

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 429,
      url: BOOK_URL,
      method: "POST",
      message: "Rate limit exceeded. Try again in 42 seconds.",
    });
  });

  it("passes the error body's data on, which the booker reads for a reschedule-limit error", async () => {
    const body = { message: "booker_limit_exceeded_error_reschedule", data: { rescheduleUid: "uid-1" } };
    respondWith(new Response(JSON.stringify(body), { status: 400 }), BOOK_URL);

    const error = await errorOf(post(BOOK_URL, {}));

    expect(error).toMatchObject({
      statusCode: 400,
      message: "booker_limit_exceeded_error_reschedule",
      data: { rescheduleUid: "uid-1" },
    });
  });

  it("falls back to the status text when the body has no message", async () => {
    respondWith(new Response(JSON.stringify({ error: "x" }), { status: 403, statusText: "Forbidden" }));

    const error = await errorOf(get(BOOK_URL));

    expect(error).toMatchObject({ statusCode: 403, message: "Forbidden", method: "GET" });
  });

  it("answers an HTML or empty error body with an HttpError, not a SyntaxError", async () => {
    respondWith(
      new Response("<!DOCTYPE html><html><body>Bad gateway</body></html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      })
    );
    const htmlError = await errorOf(post(BOOK_URL, {}));
    expect(htmlError).toBeInstanceOf(HttpError);
    expect(htmlError).toMatchObject({ statusCode: 502, message: "Bad Gateway", data: undefined });

    // HTTP/2 has no status text: the message stays empty, so the booking form shows its own retry text
    respondWith(new Response(null, { status: 413 }));
    const emptyError = await errorOf(post(BOOK_URL, {}));
    expect(emptyError).toBeInstanceOf(HttpError);
    expect(emptyError).toMatchObject({ statusCode: 413, message: "" });
  });

  it("does not throw a TypeError for a JSON body that is not an object", async () => {
    for (const body of ["null", "[1,2]", '"text"', "42"]) {
      respondWith(new Response(body, { status: 500, statusText: "Internal Server Error" }));
      const error = await errorOf(post(BOOK_URL, {}));
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ statusCode: 500, message: "Internal Server Error", data: undefined });
    }
  });

  it("ignores a message that is not a string", async () => {
    respondWith(new Response(JSON.stringify({ message: { nested: true } }), { status: 400, statusText: "Bad" }));

    expect(await errorOf(post(BOOK_URL, {}))).toMatchObject({ statusCode: 400, message: "Bad" });
  });

  it("uses the request's url when the answer has none", async () => {
    respondWith(new Response(JSON.stringify({ message: "nope" }), { status: 404 }), "");

    expect(await errorOf(get(BOOK_URL))).toMatchObject({ statusCode: 404, url: BOOK_URL });
  });

  it("returns the parsed body of a successful answer", async () => {
    const fetchMock = respondWith(new Response(JSON.stringify({ uid: "abc" }), { status: 200 }));

    await expect(post(BOOK_URL, { eventTypeId: 1 })).resolves.toEqual({ uid: "abc" });
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual({ eventTypeId: 1 });
  });
});
