"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Role } from "@/lib/types";
import { Card, CardHeader, buttonClass, inputClass } from "./ui";

type Item = {
  key: string;
  file: File;
  role: Role;
  state: "queued" | "uploading" | "done" | "error" | "needName";
  message?: string;
  name?: string;
  email?: string;
};

export function Uploader() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("PM");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function upload(item: Item) {
    patch(item.key, { state: "uploading", message: undefined });
    const fd = new FormData();
    fd.append("file", item.file);
    fd.append("role", item.role);
    if (item.name) fd.append("full_name", item.name);
    if (item.email) fd.append("email", item.email);
    try {
      const res = await fetch("/api/candidates", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        patch(item.key, { state: "done", message: `Scoring on PM + SPM rubrics…` });
        router.refresh();
      } else if (json.needName) {
        patch(item.key, { state: "needName", message: json.error, email: item.email ?? json.detectedEmail ?? "" });
      } else {
        patch(item.key, { state: "error", message: json.error ?? `Upload failed (${res.status})` });
      }
    } catch {
      patch(item.key, { state: "error", message: "Network error" });
    }
  }

  async function addFiles(files: FileList | File[]) {
    const uploadRole = role;
    const next: Item[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      role: uploadRole,
      state: "queued",
      message: "Queued",
    }));
    setItems((prev) => [...next, ...prev]);
    for (const it of next) await upload(it);
  }

  return (
    <Card>
      <CardHeader
        title="Add candidates"
        sub="Name, email and phone are stripped on our server before anything reaches the AI."
      />
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[auto_1fr] md:items-stretch">
        <fieldset>
          <legend className="text-xs font-medium text-muted">Role applied for</legend>
          <div className="mt-1.5 inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
            {(["PM", "SPM"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${
                  role === r ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {r === "PM" ? "Product Manager" : "Senior PM"}
              </button>
            ))}
          </div>
        </fieldset>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center ${
            dragging ? "border-accent bg-accent-soft" : "border-line"
          }`}
        >
          <p className="text-sm">
            Drop CVs here or{" "}
            <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => inputRef.current?.click()}>
              choose files
            </button>
          </p>
          <p className="text-xs text-muted">PDF, DOCX or TXT · up to 4 MB each · multiple files OK</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((it) => (
            <li key={it.key} className="px-4 py-2.5 text-sm sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 max-w-full truncate font-medium">{it.file.name}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{it.role}</span>
                <span
                  className={`text-xs ${
                    it.state === "error" ? "text-bad" : it.state === "needName" ? "text-warn" : it.state === "done" ? "text-good" : "text-muted"
                  }`}
                >
                  {it.state === "uploading" ? "Reading CV and stripping personal details…" : it.message}
                </span>
                {(it.state === "done" || it.state === "error") && (
                  <button type="button" className="ml-auto text-xs text-muted hover:text-ink" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}>
                    Dismiss
                  </button>
                )}
              </div>
              {it.state === "needName" && (
                <form
                  className="mt-2 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const updated = { ...it, name: String(fd.get("name")), email: String(fd.get("email")) };
                    patch(it.key, updated);
                    upload(updated);
                  }}
                >
                  <input name="name" required placeholder="Candidate full name" className={`${inputClass} max-w-56`} />
                  <input name="email" type="email" defaultValue={it.email} placeholder="Email (optional)" className={`${inputClass} max-w-64`} />
                  <button className={buttonClass.primary}>Retry</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
