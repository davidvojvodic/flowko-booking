import { DEFAULT_WEBHOOK_VERSION } from "@calcom/features/webhooks/lib/interface/IWebhookRepository";
import type { EventPayloadType } from "@calcom/features/webhooks/lib/sendPayload";
import sendPayload from "@calcom/features/webhooks/lib/sendPayload";
import { validateUrlForSSRF } from "@calcom/lib/ssrfProtection";
import { getTranslation } from "@calcom/i18n/server";

import type { TTestTriggerInputSchema } from "./testTrigger.schema";

const TEST_TRIGGER_TIMEOUT_MS = 10_000;

type TestTriggerOptions = {
  ctx: Record<string, unknown>;
  input: TTestTriggerInputSchema;
};

export const testTriggerHandler = async ({ ctx: _ctx, input }: TestTriggerOptions) => {
  const { url, type, payloadTemplate = null, secret = null } = input;

  // SSRF validation for webhook URL
  // Flowko: DNS-resolving check, so the test trigger is not a port/service oracle into the private network
  const validation = await validateUrlForSSRF(url);
  if (!validation.isValid) {
    return {
      ok: false,
      status: 400,
      message: `Webhook URL is not allowed: ${validation.error}`,
    };
  }

  const translation = await getTranslation("en", "common");
  const language = {
    locale: "en",
    translate: translation,
  };

  const data: EventPayloadType = {
    type: "Test",
    title: "Test trigger event",
    description: "",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    attendees: [
      {
        email: "jdoe@example.com",
        name: "John Doe",
        timeZone: "Europe/London",
        language,
      },
    ],
    organizer: {
      name: "Cal",
      email: "no-reply@cal.com",
      timeZone: "Europe/London",
      language,
    },
  };

  try {
    const webhook = { subscriberUrl: url, appId: null, payloadTemplate, version: DEFAULT_WEBHOOK_VERSION };
    // Flowko: bound the wait, so a slow or silent target cannot hold the request open
    return await sendPayload(secret, type, new Date().toISOString(), webhook, data, {
      timeoutMs: TEST_TRIGGER_TIMEOUT_MS,
    });
  } catch {
    return {
      ok: false,
      status: 500,
    };
  }
};
