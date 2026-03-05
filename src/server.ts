import handler from "@tanstack/react-start/server-entry";
import queueConsumer from "#/workers/queue-consumer";

export default {
  fetch: handler.fetch,
  queue: queueConsumer.queue,
};
