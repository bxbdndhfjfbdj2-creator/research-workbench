import PgBoss from "pg-boss";
import { createDbClient } from "@research-workbench/db/src/client";
import { runOutboxPass, type OutboxDispatchHandler } from "./outbox-worker";

export const workerServiceName = "research-workbench-worker";

export type RunningWorker = {
  stop: () => Promise<void>;
};

export async function startWorker(
  databaseUrl: string,
  dispatch: OutboxDispatchHandler,
): Promise<RunningWorker> {
  const db = createDbClient(databaseUrl);
  const boss = new PgBoss(databaseUrl);
  const queueName = "outbox-dispatch-pass";

  await boss.start();
  await boss.createQueue(queueName);
  await boss.work(queueName, async () => {
    await runOutboxPass(db.sql, dispatch);
  });
  await boss.schedule(queueName, "* * * * *");
  await boss.send(queueName);

  return {
    async stop() {
      await boss.stop({ graceful: true });
      await db.close();
    },
  };
}
