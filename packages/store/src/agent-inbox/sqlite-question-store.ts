import type { QuestionStore } from "@binference/engine/chat";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  answerQuestionTask,
  askQuestionTask,
  closeQuestionTask,
  getQuestionTask,
  keepQuestionCopyTask,
  openQuestionTask,
  questionByRefTask,
  questionCopiesTask,
} from "./question-tasks.js";

/** The question store's tasks, which `engine.sqlite`'s workers serve. */
export const questionTasks: readonly TaskRunner[] = [
  askQuestionTask,
  getQuestionTask,
  questionByRefTask,
  openQuestionTask,
  answerQuestionTask,
  closeQuestionTask,
  keepQuestionCopyTask,
  questionCopiesTask,
];

/** The {@link QuestionStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteQuestionStore(host: StoreHost): QuestionStore {
  const keepCopy = bindTask(host, keepQuestionCopyTask);
  return {
    ask: bindTask(host, askQuestionTask),
    get: bindTask(host, getQuestionTask),
    byRef: bindTask(host, questionByRefTask),
    openOf: bindTask(host, openQuestionTask),
    answer: bindTask(host, answerQuestionTask),
    close: bindTask(host, closeQuestionTask),
    keepCopy: async (copy, options) => {
      await keepCopy(copy, options);
    },
    copies: bindTask(host, questionCopiesTask),
  };
}
