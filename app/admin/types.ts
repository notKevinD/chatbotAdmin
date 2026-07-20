export type Tab = "dashboard" | "rag" | "chat" | "system";

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
  raw: Record<string, any>; // Mengubah unknown ke any / Record untuk mempermudah akses property opsional `.text` atau `.sheet`
};

export type MetadataRow = {
  metadata_name: string;
  created_at?: string;
  document_count: number;
  status?: string;
  error_message?: string;
  columns?: Record<string, string[]> | null;
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
  responseTimeMs?: number | null; // ← pastikan number
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
  onConfirm: () => Promise<void> | void; // Menampung async/sync callback
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
  custom: "Custom",
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
  { value: "custom", label: "Custom" },
];

export type AuditLogRow = {
  id?: string;
  action: string;
  detail?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
  admin_name?: string | null;
  admin_email?: string | null;
};

export type WebhookStatus = {
  configured: boolean;
  reachable: boolean;
  httpStatus?: number;
  error?: string;
};

export type N8nStatusResponse = {
  checkedAt: string;
  upload: WebhookStatus;
  crud: WebhookStatus;
};

export type AdminUserRow = {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
  is_active: boolean;
  created_at?: string;
};

export type DbStatsResponse = {
  tables: Array<{
    table_name: string;
    row_count: number;
    last_analyze: string | null;
    last_autoanalyze: string | null;
    analyze_count: number;
    autoanalyze_count: number;
    total_size: string;
  }>;
  indexes: Array<{ index_name: string; table_name: string; index_size: string }>;
  databaseSize: string | null;
};

export type GlobalSearchResult = {
  id: string;
  metadata_name: string;
  preview: string;
};