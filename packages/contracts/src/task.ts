import { z } from "zod";
import {
  HttpUrlSchema,
  IdentifierSchema,
  PositiveIntegerSchema,
} from "./primitives";
import { SchemaVersionSchema } from "./version";

// API_CONTRACTS.md L74-84: TaskInstruction with 5-action discriminated union.
export const TaskInstructionSchema = z.object({
  id: IdentifierSchema,
  intent: z.string().min(1),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("click"), role: z.string(), name: z.string() }),
    z.object({ kind: z.literal("fill"), label: z.string(), valueRef: z.string() }),
    z.object({ kind: z.literal("select"), label: z.string(), option: z.string() }),
    z.object({ kind: z.literal("press"), key: z.string() }),
    z.object({ kind: z.literal("assert"), text: z.string() }),
  ]),
  checkpoint: z.boolean(),
});

// API_CONTRACTS.md L51-72: TaskContract.
export const TaskContractSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  title: z.string().min(1),
  goal: z.string().min(1),
  startUrl: HttpUrlSchema,
  targetPolicy: z.enum(["public", "local-explicit"]),
  success: z.object({
    urlMatches: z.string().optional(),
    visibleText: z.string().optional(),
    selector: z.string().optional(),
  }),
  forbiddenActions: z.array(z.string()),
  expectedSteps: z.array(TaskInstructionSchema).min(1),
  fixtureValues: z.record(z.string(), z.string()),
  viewport: z.object({
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
    deviceScaleFactor: z.number().positive().optional(),
  }),
  timeoutMs: PositiveIntegerSchema,
});

export type TaskInstruction = z.infer<typeof TaskInstructionSchema>;
export type TaskContract = z.infer<typeof TaskContractSchema>;
