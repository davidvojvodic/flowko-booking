// @vitest-environment node
import { useQueryClient } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrpcProvider } from "./trpc-provider";

// Flowko U20: each server render must get its own cache. With one module-wide client the
// second request read what the first had stored (6 Nov: flowko-test's Google address in
// another account's /apps/installed/calendar HTML).
const Probe = ({ value }: { value: string }) => {
  const client = useQueryClient();
  const seen = client.getQueryData<string>(["u20-probe"]) ?? "empty";
  client.setQueryData(["u20-probe"], value);
  return <span>{seen}</span>;
};

describe("TrpcProvider on the server", () => {
  it("a second server render does not see the first render's cache", () => {
    renderToString(
      <TrpcProvider>
        <Probe value="A" />
      </TrpcProvider>
    );
    const second = renderToString(
      <TrpcProvider>
        <Probe value="B" />
      </TrpcProvider>
    );
    expect(second).toContain("empty");
    expect(second).not.toContain("A<");
  });
});
