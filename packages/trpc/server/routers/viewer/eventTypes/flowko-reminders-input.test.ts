import { describe, expect, it } from "vitest";
import { ZUpdateInputSchema } from "./types";

// Flowko U22: the tRPC update input parses metadata with EventTypeMetaDataSchema, and update.handler writes the
// parsed metadata whole, so the per-service reminder setting must come through this schema.
describe("Flowko U22: flowkoReminders in the event-type update input", () => {
  it("keeps metadata.flowkoReminders", () => {
    const result = ZUpdateInputSchema.safeParse({
      id: 1,
      metadata: { flowkoReminders: { enabled: true, offsets: [1440] }, bookerLayouts: null },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.metadata).toEqual({
      flowkoReminders: { enabled: true, offsets: [1440] },
      bookerLayouts: null,
    });
  });

  it("rejects an offset that is not offered", () => {
    const result = ZUpdateInputSchema.safeParse({
      id: 1,
      metadata: { flowkoReminders: { enabled: true, offsets: [60] } },
    });
    expect(result.success).toBe(false);
  });
});
