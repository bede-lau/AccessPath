import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendNdjsonEvent,
  NdjsonEventStore,
  readNdjsonEvents,
} from "../src/index";
import { event } from "./fixtures";

const temporaryDirectories: string[] = [];

async function temporaryEventPath() {
  const directory = await mkdtemp(join(tmpdir(), "accesspath-events-"));
  temporaryDirectories.push(directory);
  return join(directory, "events.ndjson");
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("NDJSON event store", () => {
  it("appends ordered events and replays strictly after a sequence", async () => {
    const path = await temporaryEventPath();
    const store = new NdjsonEventStore(path);
    await store.append(event(1));
    await store.append(event(3));
    await store.append(event(5));

    const replay = await store.replayAfter(1);
    expect(replay.events.map((entry) => entry.sequence)).toEqual([3, 5]);
    expect(replay.ignoredLines).toBe(0);
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("serializes concurrent appends to one file", async () => {
    const path = await temporaryEventPath();
    await Promise.all([
      appendNdjsonEvent(path, event(1)),
      appendNdjsonEvent(path, event(2)),
      appendNdjsonEvent(path, event(3)),
    ]);
    expect((await readNdjsonEvents(path)).events.map((entry) => entry.sequence)).toEqual([
      1, 2, 3,
    ]);
  });

  it("rejects a non-increasing append without modifying prior events", async () => {
    const path = await temporaryEventPath();
    await appendNdjsonEvent(path, event(2));
    await expect(appendNdjsonEvent(path, event(2, { eventId: "duplicate" }))).rejects.toThrow(
      /not greater/,
    );
    expect((await readNdjsonEvents(path)).events).toHaveLength(1);
  });

  it("tolerates corrupt and duplicate lines while keeping first ordered events", async () => {
    const path = await temporaryEventPath();
    await writeFile(
      path,
      [
        JSON.stringify(event(3)),
        "{broken",
        JSON.stringify(event(1)),
        JSON.stringify(event(1)),
        JSON.stringify(event(3, { eventId: "same-sequence" })),
        "",
      ].join("\n"),
    );

    const result = await readNdjsonEvents(path);
    expect(result.events.map((entry) => entry.sequence)).toEqual([1, 3]);
    expect(result.ignoredLines).toBe(3);
  });
});
