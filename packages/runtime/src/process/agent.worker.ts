// The agent database's store worker, built beside the runtime's entry as `agent.worker.mjs`: the
// built runtime may read only the files it is granted, and its workers load by URL beside it.
// oxlint-disable-next-line import/no-unassigned-import -- a worker entry runs the store's worker for its effect
import "@binference/store/agent-worker";
