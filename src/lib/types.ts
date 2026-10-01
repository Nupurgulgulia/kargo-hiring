export type Role = "PM" | "SPM";
export const ROLES: Role[] = ["PM", "SPM"];
export const ROLE_TITLES: Record<Role, string> = {
  PM: "Product Manager",
  SPM: "Senior Product Manager",
};

export type Criterion = {
  key: string;
  name: string;
  weight: number;
  guidance: string;
};

export type Rubric = {
  role: Role;
  title: string;
  threshold: number;
  lower_tier_below: number | null;
  criteria: Criterion[];
  scale: Record<string, string>;
  notes: string | null;
};

export type CriterionScore = {
  key: string;
  name: string;
  weight: number;
  score: number; // 1–5
  points: number; // (score / 5) * weight
  evidence: string;
  rationale: string;
};

export type ScoreRow = {
  candidate_id: string;
  role: Role;
  total: number;
  criteria: CriterionScore[];
  summary: string | null;
  model: string | null;
};

export type Extraction = {
  headline: string;
  total_years_experience: number;
  pm_years_experience: number;
  current_title: string;
  roles: {
    title: string;
    organization: string;
    industry: string;
    period: string;
    inside_logistics_operation: boolean;
    highlights: string[];
  }[];
  education: string[];
  skills: string[];
  location: string;
};

export type Brief = {
  headline: string;
  fit_summary: string;
  strengths: string[];
  gaps: string[];
  questions: { question: string; probes: string }[];
  verify: string[];
};

export type EmailKind = "invite" | "reject";
export type EmailStatus = "draft" | "sending" | "sent" | "failed";

export type EmailRow = {
  candidate_id: string;
  kind: EmailKind;
  subject: string;
  body: string;
  status: EmailStatus;
  resend_id: string | null;
  sent_at: string | null;
  sent_to: string | null;
  error: string | null;
  updated_at: string;
};

export type Decision = "pending" | "invite" | "reject" | "hold";

export type Candidate = {
  id: string;
  created_at: string;
  applied_role: Role;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cv_filename: string | null;
  cv_storage_path: string | null;
  redacted_text: string | null;
  extracted: Extraction | null;
  status: "processing" | "ready" | "error";
  error: string | null;
  decision: Decision;
  pm_score: number | null;
  spm_score: number | null;
  applied_score: number | null;
  recommendation: EmailKind | null;
  arjun_notes: string | null;
};

export type EventRow = {
  id: number;
  candidate_id: string | null;
  at: string;
  actor: "system" | "ai" | "arjun";
  action: string;
  detail: Record<string, unknown> | null;
};

export type ReferenceHire = {
  slug: string;
  position: number;
  name: string;
  outcome: "exceeds" | "meets" | "below";
  pm_score: number;
  spm_score: number;
  background: string;
  standout: string;
  signals: Record<string, { s: "strong" | "some" | "absent"; note: string }>;
};

export type InstinctSignal = {
  key: string;
  position: number;
  name: string;
  strong: string;
  weaker: string;
  evidence: string;
  confidence: "high" | "moderate" | "tentative";
  overlaps_rubric: string | null;
};

export type FoundersReadRow = {
  candidate_id: string;
  content: import("./founder-rules").FoundersRead;
  model: string | null;
  created_at: string;
};
