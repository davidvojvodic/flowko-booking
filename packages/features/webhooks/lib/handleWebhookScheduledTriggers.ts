import dayjs from "@calcom/dayjs";
import logger from "@calcom/lib/logger";
import { validateUrlForSSRF } from "@calcom/lib/ssrfProtection";
import type { PrismaClient } from "@calcom/prisma";

import { DEFAULT_WEBHOOK_VERSION } from "./interface/IWebhookRepository";
import { createWebhookSignature, jsonParse } from "./sendPayload";

export async function handleWebhookScheduledTriggers(prisma: PrismaClient) {
  await prisma.webhookScheduledTriggers.deleteMany({
    where: {
      startAfter: {
        lte: dayjs().subtract(1, "day").toDate(),
      },
    },
  });
  // get jobs that should be run
  const jobsToRun = await prisma.webhookScheduledTriggers.findMany({
    where: {
      startAfter: {
        lte: dayjs().toDate(),
      },
    },
    select: {
      id: true,
      jobName: true,
      payload: true,
      subscriberUrl: true,
      webhook: {
        select: {
          secret: true,
          version: true,
        },
      },
    },
  });

  const fetchPromises: Promise<Response | void>[] = [];

  // run jobs
  for (const job of jobsToRun) {
    // Fetch the webhook configuration so that we can get the secret.
    let webhook = job.webhook;

    // only needed to support old jobs that don't have the webhook relationship yet
    if (!webhook && job.jobName) {
      const [appId, subscriberId] = job.jobName.split("_");
      try {
        webhook = await prisma.webhook.findUniqueOrThrow({
          where: { id: subscriberId, appId: appId !== "null" ? appId : null },
          select: { secret: true, version: true },
        });
      } catch {
        logger.error(`Error finding webhook for subscriberId: ${subscriberId}, appId: ${appId}`);
      }
    }

    const headers: Record<string, string> = {
      "Content-Type":
        !job.payload || jsonParse(job.payload) ? "application/json" : "application/x-www-form-urlencoded",
      "X-Cal-Webhook-Version": webhook?.version ?? DEFAULT_WEBHOOK_VERSION,
    };

    if (webhook) {
      headers["X-Cal-Signature-256"] = createWebhookSignature({ secret: webhook.secret, body: job.payload });
    }
    // Flowko: re-check the URL (with DNS) right before delivery, as sendPayload does: this cron does its
    // own fetch. A refused job is skipped but still deleted below. http: is allowed here (https-only is
    // enforced when the URL is saved). The log names no URL (U7b).
    const ssrfValidation = await validateUrlForSSRF(job.subscriberUrl, { allowHttp: true });
    if (!ssrfValidation.isValid) {
      logger.warn(`Webhook trigger ${job.id} skipped: Webhook URL is not allowed: ${ssrfValidation.error}`);
    } else {
      fetchPromises.push(
        fetch(job.subscriberUrl, {
          method: "POST",
          body: job.payload,
          headers,
          // Avoid following redirect
          redirect: "manual",
        }).catch((error) => {
          console.error(`Webhook trigger ${job.id} failed with error: ${error}`);
        })
      );
    }

    // clean finished job
    await prisma.webhookScheduledTriggers.delete({
      where: {
        id: job.id,
      },
    });
  }

  Promise.allSettled(fetchPromises);
}
