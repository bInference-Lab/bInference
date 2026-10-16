import { describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { createTopicFanout } from "./topic-fanout";

const refetch = async (): Promise<void> => Promise.resolve();

describe("createTopicFanout", () => {
  it("gives each listener of a topic its pushes over one subscription, until the last stops", () => {
    const engine = fakeClient({});
    const fanout = createTopicFanout(engine.client);
    const heard: string[] = [];
    const stopFirst = fanout.listen("notice", {
      onPush: (p) => heard.push(`a ${p.kind}`),
      refetch,
    });
    const stopSecond = fanout.listen("notice", {
      onPush: (p) => heard.push(`b ${p.kind}`),
      refetch,
    });
    engine.push("notice", "notice/new", {});
    stopFirst();
    engine.push("notice", "notice/new", {});
    stopSecond();
    engine.push("notice", "notice/new", {});
    expect(heard).toStrictEqual(["a notice/new", "b notice/new", "b notice/new"]);
  });
});
