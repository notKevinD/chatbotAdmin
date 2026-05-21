export type RawRecord = Record<string, unknown>;

export function asText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readPath(source: RawRecord, path: string[]) {
  let current: unknown = source;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as RawRecord)[key];
  }

  return asText(current);
}

export function extractMessageCategory(row: RawRecord, messageObject: RawRecord = {}) {
  const candidates = [
    asText(row.category),
    asText(row.kategori),
    asText(row.question_category),
    asText(row.intent),
    asText(messageObject.category),
    asText(messageObject.kategori),
    asText(messageObject.question_category),
    asText(messageObject.intent),
    readPath(messageObject, ["metadata", "category"]),
    readPath(messageObject, ["metadata", "kategori"]),
    readPath(messageObject, ["additional_kwargs", "category"]),
    readPath(messageObject, ["additional_kwargs", "kategori"]),
    readPath(messageObject, ["response_metadata", "category"]),
    readPath(messageObject, ["response_metadata", "kategori"]),
    readPath(messageObject, ["data", "category"]),
    readPath(messageObject, ["data", "kategori"])
  ];

  return candidates.find((item) => item.trim())?.trim() || "";
}

export function normalizeMessage(row: RawRecord) {
  const parsedMessage = parseMaybeJson(row.message ?? row.data ?? row.content ?? row.value);
  const messageObject =
    parsedMessage && typeof parsedMessage === "object" && !Array.isArray(parsedMessage)
      ? (parsedMessage as RawRecord)
      : {};

  const role =
    asText(row.role || row.type || messageObject.type || messageObject.role || messageObject.name) ||
    "message";

  const content =
    asText(row.question) ||
    asText(row.answer) ||
    asText(row.content) ||
    asText(messageObject.content) ||
    asText(messageObject.text) ||
    asText(parsedMessage);

  return {
    role: role.toLowerCase(),
    content,
    category: extractMessageCategory(row, messageObject),
    raw: row
  };
}

export function looksLikeQuestion(role: string) {
  return ["human", "user", "question", "input"].some((item) => role.includes(item));
}

export function looksLikeAnswer(role: string) {
  return ["ai", "assistant", "bot", "answer", "output"].some((item) => role.includes(item));
}

export function isInternalAgentMessage(role: string, content: string) {
  const text = content.trim();

  if (["tool", "function", "system"].some((item) => role.includes(item))) return true;

  return [
    /^calling\s+[\w.-]+\s+with input:/i,
    /^called\s+[\w.-]+\s+with output:/i,
    /^tool\s*call:/i,
    /^function\s*call:/i,
    /Postgres_PGVector_Store/i
  ].some((pattern) => pattern.test(text));
}
