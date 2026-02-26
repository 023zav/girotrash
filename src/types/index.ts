export type ReportStatus =
  | 'pending_review'
  | 'approved_sending'
  | 'sent'
  | 'replied'
  | 'rejected'
  | 'deleted';

export type ReportCategory = 'waste' | 'litter';

export interface Report {
  id: string;
  created_at: string;
  status: ReportStatus;
  lat: number;
  lon: number;
  distance_to_girona_m: number;
  inside_service_area: boolean;
  address_label: string | null;
  description: string | null;
  category: ReportCategory;
  email_lang: 'ca' | 'es' | 'en';
  fcc_incident_id: string | null;
  sent_at: string | null;
  reply_text: string | null;
  reply_from: string | null;
  replied_at: string | null;
  admin_override: boolean;
  user_device_id: string | null;
  ip_hash: string | null;
  last_error: string | null;
}

export interface ReportMedia {
  id: string;
  report_id: string;
  storage_path: string;
  mime_type: string;
  compressed_bytes: number;
  width: number;
  height: number;
  created_at: string;
}

export interface ReportWithMedia extends Report {
  report_media: ReportMedia[];
}

export interface CreateReportPayload {
  lat: number;
  lon: number;
  description: string;
  category: ReportCategory;
  photo_count: number;
  honeypot?: string;
  device_id?: string;
}

export interface CreateReportResponse {
  report_id: string;
  upload_urls: {
    path: string;
    signed_url: string;
    token: string;
  }[];
}

export interface ReverseGeocodeResponse {
  address_label: string;
}

export interface LocalReport {
  id: string;
  created_at: string;
  status: ReportStatus;
  lat: number;
  lon: number;
  description: string;
}

export type SupportedLang = 'ca' | 'es' | 'en';
