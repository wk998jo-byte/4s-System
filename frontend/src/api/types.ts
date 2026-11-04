export type PrototypeModule =
  | "ai_camera"
  | "dashcam"
  | "speed"
  | "sos"
  | "other";

export type PrototypeStatus = "open" | "under_process" | "closed";

export interface PrototypeRecord {
  id: string;
  title: string;
  module_type: PrototypeModule;
  status: PrototypeStatus;
  notes: string | null;
  created_at: string;
  prototype: boolean;
}

export interface PrototypeRecordList {
  items: PrototypeRecord[];
  page: number;
  page_size: number;
  total: number;
  storage: string;
  prototype: boolean;
}

export interface PrototypeRecordCreate {
  title: string;
  module_type: PrototypeModule;
  status: PrototypeStatus;
  notes?: string;
}

export interface DashboardSummary {
  prototype: boolean;
  storage: string;
  authentication: string;
  generated_at: string;
  kpis: {
    total_records: number;
    open: number;
    under_process: number;
    closed: number;
  };
  by_module: Record<string, number>;
  limitations: string[];
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  storage: string;
  authenticated: boolean;
  prototype: boolean;
  message: string;
}

export interface ApiErrorDetail {
  field: string;
  code: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: ApiErrorDetail[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
