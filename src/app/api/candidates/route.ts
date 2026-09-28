import { after, NextResponse } from "next/server";
import { ACCEPTED_EXTENSIONS, extractCvText } from "@/lib/cv-parse";
import { assertNoPII, detectContact, redact } from "@/lib/pii";
import { processCandidate } from "@/lib/pipeline";
import { logEvent, one, query } from "@/lib/db";
import type { Role } from "@/lib/types";

export const maxDuration = 300;

const MAX_BYTES = 4 * 1024 * 1024;

// Trigger: Arjun uploads a CV and selects the role. Input: file + role.
// The backend extracts text, separates PII into its own columns, redacts the text, stores the
// record, and kicks off the AI pipeline in the background on redacted content only.
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const role = String(form.get("role") ?? "") as Role;
  const nameOverride = String(form.get("full_name") ?? "").trim() || null;
  const emailOverride = String(form.get("email") ?? "").trim() || null;

  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (role !== "PM" && role !== "SPM") return NextResponse.json({ error: "Select PM or SPM" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 4 MB" }, { status: 400 });
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: "Upload a PDF, DOCX or TXT file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rawText: string;
  try {
    rawText = await extractCvText(file.name, buffer);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  const detected = detectContact(rawText);
  const contact = {
    full_name: nameOverride ?? detected.full_name,
    email: emailOverride ?? detected.email,
    phone: detected.phone,
  };
  // Without a name we cannot guarantee it is stripped before the AI sees the CV, so ask for it.
  if (!contact.full_name) {
    return NextResponse.json(
      {
        error: "Couldn't find the candidate's name in this CV. Enter it so it can be removed before AI scoring.",
        needName: true,
        detectedEmail: detected.email,
      },
      { status: 422 },
    );
  }

  const redacted = redact(rawText, contact);
  try {
    assertNoPII(redacted, contact);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  // The original file is kept in kargo_cv_files; cv_storage_path records where it lives.
  const row = await one<{ id: string }>(
    `insert into kargo_candidates (applied_role, full_name, email, phone, cv_filename, cv_storage_path, redacted_text, status)
     values ($1, $2, $3, $4, $5, 'kargo_cv_files', $6, 'processing') returning id`,
    [role, contact.full_name, contact.email, contact.phone, file.name, redacted],
  );
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  await query("insert into kargo_cv_files (candidate_id, filename, content_type, data) values ($1, $2, $3, $4)", [
    row.id,
    file.name,
    file.type || "application/octet-stream",
    buffer,
  ]);

  await logEvent(row.id, "arjun", "cv_uploaded", {
    role,
    filename: file.name,
    pii_stripped: { name: true, email: Boolean(contact.email), phone: Boolean(contact.phone) },
  });

  after(() => processCandidate(row.id));
  return NextResponse.json({ id: row.id }, { status: 201 });
}
