// workers/crawler-worker
//
// Consumes `crawl.requested` events and builds the categorized URL tree for the
// requested portals, then publishes `crawl.completed` with the result. Heavy
// crawling is offloaded from the request path.

import { createLogger } from "@intel.dom.gob/logger";
import { createEventBus } from "@intel.dom.gob/events";
import { buildCategorizedUrlTree } from "@intel.dom.gob/service-crawler";

const log = createLogger("worker:crawler");

interface CrawlRequested {
  requestId: string;
  portals?: string[];
}

async function main(): Promise<void> {
  const bus = createEventBus({ redisUrl: process.env.REDIS_URL, inMemory: !process.env.REDIS_URL });

  bus.subscribe<CrawlRequested>("crawl.requested" as any, async (env) => {
    const { requestId } = env.payload;
    log.info("Crawl started", { requestId });
    try {
      const tree = await buildCategorizedUrlTree();
      await bus.publish("crawl.completed" as any, { requestId, portals: tree }, requestId);
      log.info("Crawl completed", { requestId, portalCount: tree.length });
    } catch (err) {
      log.error("Crawl failed", { requestId, error: String(err) });
    }
  });

  log.info("Crawler worker listening for crawl.requested");
}

main().catch((e) => {
  log.error("Crawler worker crashed", { error: String(e) });
  process.exit(1);
});
