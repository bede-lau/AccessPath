import {
  AccessPathEventSchema,
  type AccessPathEvent,
} from "@accesspath/contracts";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import { redactValue } from "./redaction";

type EventReadResult = {
  events: AccessPathEvent[];
  ignoredLines: number;
};

const appendQueues = new Map<string, Promise<void>>();

export async function readNdjsonEvents(
  path: string,
  afterSequence = -1,
): Promise<EventReadResult> {
  let content: string;
  try {
    content = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], ignoredLines: 0 };
    }
    throw error;
  }

  const byEventId = new Map<string, AccessPathEvent>();
  const usedSequences = new Set<number>();
  let ignoredLines = 0;

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const event = AccessPathEventSchema.parse(JSON.parse(line));
      if (
        event.sequence <= afterSequence ||
        byEventId.has(event.eventId) ||
        usedSequences.has(event.sequence)
      ) {
        if (event.sequence > afterSequence) {
          ignoredLines += 1;
        }
        continue;
      }
      byEventId.set(event.eventId, event);
      usedSequences.add(event.sequence);
    } catch {
      ignoredLines += 1;
    }
  }

  return {
    events: [...byEventId.values()].sort(
      (left, right) => left.sequence - right.sequence,
    ),
    ignoredLines,
  };
}

export async function appendNdjsonEvent(
  path: string,
  input: AccessPathEvent,
): Promise<void> {
  const event = AccessPathEventSchema.parse(redactValue(input));
  const previous = appendQueues.get(path) ?? Promise.resolve();
  const current = previous.then(async () => {
    await fs.mkdir(dirname(path), { recursive: true });
    const existing = await readNdjsonEvents(path);
    const latest = existing.events.at(-1);
    if (latest !== undefined && event.sequence <= latest.sequence) {
      throw new Error(
        `Event sequence ${event.sequence} is not greater than ${latest.sequence}.`,
      );
    }
    await fs.appendFile(path, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  });
  appendQueues.set(path, current);
  try {
    await current;
  } finally {
    if (appendQueues.get(path) === current) {
      appendQueues.delete(path);
    }
  }
}

export class NdjsonEventStore {
  public constructor(private readonly path: string) {}

  append(event: AccessPathEvent): Promise<void> {
    return appendNdjsonEvent(this.path, event);
  }

  replayAfter(sequence: number): Promise<EventReadResult> {
    return readNdjsonEvents(this.path, sequence);
  }

  readAll(): Promise<EventReadResult> {
    return readNdjsonEvents(this.path);
  }
}
