export type Tab = "dashboard" | "rag" | "chat";

export type Range =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all"
  | "custom";

export type Overview = {
  filter?: {
    startDate: string;
    endDate: string;
    granularity: "three_hour" | "day" | "week" | "month";
  };
  stats: {
    users: number;
    chats: number;
    unanswered: number;
  };
  questionSeries: Array<{ label: string; count: number }>;
  unansweredSamples: UnansweredItem[];
};

export type UnansweredItem = {
  sessionId: string;
  question: string;
  answer: string;
  isFallback?: boolean;
  createdAt?: string;
};

export type DocumentRow = {
  id: string;
  metadata_name: string;
  preview: string;
  raw: Record<string, unknown>;
};

export type MetadataRow = {
  metadata_name: string;
  created_at?: string;
  document_count: number;
  status?: string;
  error_message?: string;
};

export type DocumentsResponse = {
  mode: "metadata" | "documents";
  metadataName?: string;
  rows: Array<DocumentRow | MetadataRow>;
  pagination?: PaginationInfo;
  columns?: string[];
  idColumn?: string;
  metaColumn?: string;
};

export type ChatSession = {
  sessionId: string;
  total: number;
  lastSeen?: string;
  visitorName?: string;
  visitorPhoneNumber?: string;
  visitorSchoolOrigin?: string;
};

export type ChatPair = {
  id?: string;
  sessionId?: string;
  question: string;
  answer: string;
  context?: unknown;
  responseTimeMs?: number | string | null;
  isFallback?: boolean;
  createdAt?: string;
  visitorName?: string;
  visitorPhoneNumber?: string;
  visitorSchoolOrigin?: string;
};

export type PaginationInfo = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ExcelSheetPreview = {
  sheetName: string;
  totalRows: number;
  totalColumns: number;
  headers: string[];
  rows: string[][];
};

export type ExcelPreview = ExcelSheetPreview & {
  fileName: string;
  sheets: ExcelSheetPreview[];
};

export type ConfirmDialogState = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

export type DuplicateCheckResponse = {
  duplicate: boolean;
};

export const PAGE_SIZE = 10;
export const UNANSWERED_PAGE_SIZE = 5;

export const rangeLabel: Record<Range, string> = {
  today: "Hari Ini",
  yesterday: "Kemarin",
  this_week: "Minggu Ini",
  last_week: "Minggu Lalu",
  this_month: "Bulan Ini",
  last_month: "Bulan Lalu",
  this_year: "Tahun Ini",
  all: "Selamanya",
  custom: "Custom"
};

export const reportRangeOptions: Array<{ value: Range; label: string }> = [
  { value: "today", label: "Hari ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "this_week", label: "Minggu ini" },
  { value: "last_week", label: "Minggu lalu" },
  { value: "this_month", label: "Bulan ini" },
  { value: "last_month", label: "Bulan lalu" },
  { value: "this_year", label: "Tahun ini" },
  { value: "all", label: "Selamanya" },
  { value: "custom", label: "Custom" }
];
