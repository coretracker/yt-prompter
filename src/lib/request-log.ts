import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function stringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function writeApiLogFile(params: {
  route: string;
  level: "error" | "warn" | "info";
  event: string;
  error?: unknown;
  context?: unknown;
}) {
  const now = new Date();
  const fileName = `${now.toISOString().replace(/[:.]/g, "-")}_${randomUUID()}.txt`;
  const logDir = path.join(process.cwd(), "logs");
  const errorMessage = params.error instanceof Error ? params.error.message : undefined;
  const errorStack = params.error instanceof Error ? params.error.stack : undefined;

  const body = [
    `[${now.toISOString()}] ${params.level.toUpperCase()} ${params.route} ${params.event}`,
    "",
    "context:",
    stringify(params.context ?? {}),
    "",
    "error_message:",
    errorMessage ?? "n/a",
    "",
    "error_stack:",
    errorStack ?? "n/a",
    "",
  ].join("\n");

  await mkdir(logDir, { recursive: true });
  await writeFile(path.join(logDir, fileName), body, "utf8");
}
