"use client";
// src/features/mailing/components/CampaignEditor.tsx
// Write, preview and send one mailing-list email. Drafts and presets autosave; the
// preview is rendered by the same server code that builds the real email, so what
// shows here is exactly what lands. Once an email is scheduled or sent the content
// locks and the page shows who it went to instead. Drafts get a template dropdown
// beside the preview that swaps presets while keeping any field already edited.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { SendDialog, type SendMode } from "@/features/mailing/components/SendDialog";
import { callApi } from "@/features/mailing/lib/api-client";
import type { CampaignRow } from "@/features/mailing/lib/campaign-row";
import { shrinkImage } from "@/features/mailing/lib/resize-image";
import {
  BLANK_TEMPLATE_ID,
  matchTemplate,
  switchTemplate,
  type Template,
} from "@/features/mailing/lib/templates";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type { QuietHours } from "@/shared/lib/quiet-hours";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";

/** One recipient's copy of a sent email. */
export interface SendRow {
  id: string;
  name: string;
  email: string;
  status: "pending" | "sent" | "failed";
  error: string | null;
}

/** A placeholder the operator can insert. */
export interface PlaceholderHelp {
  key: string;
  help: string;
}

/** Editable fields, as last saved. */
interface Content {
  name: string;
  subject: string;
  preheader: string;
  body: string;
}

type SaveState = "saved" | "saving" | "unsaved" | "error";

const AUTOSAVE_MS = 800;
const PREVIEW_MS = 500;

const SEND_PILL: Record<SendRow["status"], { tone: StatusTone; label: string }> = {
  pending: { tone: "neutral", label: "Waiting" },
  sent: { tone: "success", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
};

/** Formatting shortcuts in the helper strip: text to insert and where the cursor lands. */
const SNIPPETS: { label: string; title: string; before: string; after: string; line?: boolean }[] =
  [
    { label: "Heading", title: "Big heading", before: "# ", after: "", line: true },
    { label: "Bold", title: "Bold text", before: "**", after: "**" },
    { label: "List", title: "Bullet point", before: "- ", after: "", line: true },
    { label: "Link", title: "Link inside a sentence", before: "[", after: "](https://)" },
    {
      label: "Button",
      title: "Big button on its own line",
      before: "[",
      after: "](https://)",
      line: true,
    },
  ];

/**
 * Mailing email editor.
 * @param props - Component props.
 * @param props.initial - The email as saved.
 * @param props.sends - Per-recipient results, for an email that has gone out.
 * @param props.placeholders - Placeholders the renderer understands.
 * @param props.missingEnv - Env vars sending needs that aren't set.
 * @param props.canUpload - Whether image uploads are configured.
 * @param props.quiet - Live quiet-hours window.
 * @param props.promoTitle - Title of the linked promo, if any.
 * @param props.adminEmail - Inbox test sends go to.
 * @param props.templates - Templates for the dropdown; empty when the email isn't a draft.
 * @returns Editor element.
 */
export function CampaignEditor({
  initial,
  sends,
  placeholders,
  missingEnv,
  canUpload,
  quiet,
  promoTitle,
  adminEmail,
  templates,
}: {
  initial: CampaignRow;
  sends: SendRow[];
  placeholders: PlaceholderHelp[];
  missingEnv: string[];
  canUpload: boolean;
  quiet: QuietHours;
  promoTitle: string | null;
  adminEmail: string | null;
  templates: Template[];
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const editable = initial.isPreset || initial.status === "draft";

  const [content, setContent] = useState<Content>({
    name: initial.name,
    subject: initial.subject,
    preheader: initial.preheader ?? "",
    body: initial.body,
  });
  const [promoId, setPromoId] = useState(initial.promoId);
  const [templateId, setTemplateId] = useState(() => matchTemplate(content, templates));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saved = useRef<Content>(content);
  const saving = useRef<Promise<boolean> | null>(null);

  const [preview, setPreview] = useState<{ html: string; subject: string; problems: string[] }>();
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SendMode | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Writes whatever changed since the last save.
   * @returns False when the save failed.
   */
  const save = useCallback(async (): Promise<boolean> => {
    if (!editable) return true;
    // Chain behind a save already in flight so two PATCHes never race.
    if (saving.current) await saving.current;
    const target = content;
    const changed: Record<string, string> = {};
    for (const key of Object.keys(target) as (keyof Content)[]) {
      if (target[key] !== saved.current[key]) changed[key] = target[key];
    }
    if (Object.keys(changed).length === 0) {
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    const run = callApi(`/api/admin/mailing/${initial.id}`, "PATCH", changed).then((res) => {
      if (!res.ok) {
        setSaveState("error");
        toast(res.error, { tone: "error" });
        return false;
      }
      saved.current = target;
      return true;
    });
    saving.current = run;
    const ok = await run;
    saving.current = null;
    if (ok) setSaveState((s) => (s === "saving" ? "saved" : s));
    return ok;
  }, [content, editable, initial.id, toast]);

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (!editable) return;
    const dirty = (Object.keys(content) as (keyof Content)[]).some(
      (k) => content[k] !== saved.current[k],
    );
    if (!dirty) return;
    setSaveState("unsaved");
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [content, editable, save]);

  // Warn before leaving with an edit still unsaved.
  useEffect(() => {
    if (saveState === "saved") return;
    /**
     * Asks the browser to confirm leaving the page.
     * @param e - The unload event.
     */
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  // Live preview, debounced; a stale reply is dropped if a newer one was asked for.
  const previewSeq = useRef(0);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      void callApi<{ html: string; subject: string; problems: string[] }>(
        "/api/admin/mailing/preview",
        "POST",
        {
          subject: content.subject,
          preheader: content.preheader || null,
          body: content.body,
          promoId,
        },
      ).then((res) => {
        if (seq !== previewSeq.current) return;
        if (res.ok) setPreview({ html: res.html, subject: res.subject, problems: res.problems });
      });
    }, PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [content.subject, content.preheader, content.body, promoId]);

  /**
   * Updates one field.
   * @param key - Field name.
   * @param value - New value.
   */
  function setField(key: keyof Content, value: string): void {
    setContent((c) => ({ ...c, [key]: value }));
  }

  /**
   * Switches template, keeping any field already made the operator's own.
   * @param id - Template to apply.
   */
  function applyTemplate(id: string): void {
    const to = templates.find((t) => t.id === id);
    if (!to) return;
    const from = templates.find((t) => t.id === templateId) ?? null;
    setContent((c) => switchTemplate(c, from, to));
    setTemplateId(id);
  }

  /**
   * Inserts text at the cursor in the body, wrapping any selected text.
   * @param before - Text before the selection.
   * @param after - Text after the selection.
   * @param line - Start on a fresh line.
   */
  function insert(before: string, after = "", line = false): void {
    const el = bodyRef.current;
    const body = content.body;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const lead = line && start > 0 && body[start - 1] !== "\n" ? "\n" : "";
    const next = body.slice(0, start) + lead + before + selected + after + body.slice(end);
    setField("body", next);
    // Put the cursor inside the inserted markers once React has re-rendered.
    const cursor = start + lead.length + before.length + selected.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  /**
   * Shrinks, uploads and inserts a picture on its own line.
   * @param file - Picked image.
   */
  async function addImage(file: File): Promise<void> {
    setBusy("image");
    try {
      const small = await shrinkImage(file);
      const form = new FormData();
      form.append("file", small);
      const res = await callApi<{ url: string }>("/api/admin/mailing/upload", "POST", form);
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return;
      }
      insert(`\n![Picture](${res.url})\n`, "", true);
      toast('Picture added. Change "Picture" to a few words describing it.', { tone: "success" });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add the picture.", {
        tone: "error",
      });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Saves, then sends the saved version to the operator. */
  async function sendTest(): Promise<void> {
    setBusy("test");
    if (!(await save())) {
      setBusy(null);
      return;
    }
    const res = await callApi(`/api/admin/mailing/${initial.id}/test`, "POST");
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    else toast(`Test sent to ${adminEmail ?? "your inbox"}.`, { tone: "success" });
  }

  /**
   * Saves, then opens the send dialog.
   * @param mode - Send now or schedule.
   */
  async function openDialog(mode: SendMode): Promise<void> {
    if (await save()) setDialog(mode);
  }

  /** Detaches the email from its promo, so it describes whatever promo is running. */
  async function unlinkPromo(): Promise<void> {
    setBusy("unlink");
    const res = await callApi(`/api/admin/mailing/${initial.id}`, "PATCH", { promoId: null });
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    else setPromoId(null);
  }

  /** Turns a scheduled email back into an editable draft. */
  async function cancelSchedule(): Promise<void> {
    setBusy("unschedule");
    const res = await callApi(`/api/admin/mailing/${initial.id}/schedule`, "DELETE");
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    router.refresh();
  }

  /** Re-sends only the copies that failed. */
  async function retryFailed(): Promise<void> {
    setBusy("retry");
    const res = await callApi<{ sent: number; failed: number }>(
      `/api/admin/mailing/${initial.id}/send`,
      "POST",
      { mode: "retry" },
    );
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    else
      toast(
        res.failed > 0
          ? `${res.sent} went this time, ${res.failed} still failed.`
          : `All ${res.sent} sent.`,
        { tone: res.failed > 0 ? "warning" : "success" },
      );
    router.refresh();
  }

  const sendBlocked =
    missingEnv.length > 0 ? `Sending is off until ${missingEnv.join(", ")} is set.` : null;
  const failedCount = sends.filter((s) => s.status === "failed").length;

  return (
    <div className="flex flex-col gap-6">
      <StatusBanner
        campaign={initial}
        busy={busy}
        onCancelSchedule={() => void cancelSchedule()}
        onRefresh={() => router.refresh()}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label={initial.isPreset ? "Preset name" : "Name (only you see this)"}>
              <input
                value={content.name}
                onChange={(e) => setField("name", e.target.value)}
                disabled={!editable}
                maxLength={120}
                className={ADMIN_INPUT_CLS}
              />
            </Field>
            <Field label="Subject">
              <input
                value={content.subject}
                onChange={(e) => setField("subject", e.target.value)}
                disabled={!editable}
                maxLength={200}
                className={ADMIN_INPUT_CLS}
              />
            </Field>
            <Field label="Preview text (shows after the subject in most inboxes)">
              <input
                value={content.preheader}
                onChange={(e) => setField("preheader", e.target.value)}
                disabled={!editable}
                maxLength={200}
                className={ADMIN_INPUT_CLS}
              />
            </Field>

            {promoId && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm">
                <span>
                  Promo wording comes from <strong>{promoTitle ?? "a promo"}</strong>. It won&apos;t
                  send once that promo has ended.
                </span>
                {editable && (
                  <AdminButton
                    size="xs"
                    variant="ghost"
                    busy={busy === "unlink"}
                    onClick={() => void unlinkPromo()}
                  >
                    Unlink
                  </AdminButton>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-admin-text">Email</span>
              {editable && (
                <div className="flex flex-wrap gap-1.5">
                  {SNIPPETS.map((s) => (
                    <AdminButton
                      key={s.label}
                      size="xs"
                      variant="secondary"
                      onClick={() => insert(s.before, s.after, s.line)}
                    >
                      <span title={s.title}>{s.label}</span>
                    </AdminButton>
                  ))}
                  <AdminButton
                    size="xs"
                    variant="secondary"
                    busy={busy === "image"}
                    disabled={!canUpload}
                    onClick={() => fileRef.current?.click()}
                  >
                    <span title={canUpload ? "Add a picture" : "Set BLOB_READ_WRITE_TOKEN first"}>
                      Picture
                    </span>
                  </AdminButton>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void addImage(file);
                    }}
                  />
                </div>
              )}
              <textarea
                ref={bodyRef}
                value={content.body}
                onChange={(e) => setField("body", e.target.value)}
                disabled={!editable}
                rows={18}
                className={cn(ADMIN_INPUT_CLS, "font-mono text-sm leading-relaxed")}
              />
              {editable && (
                <details className="text-sm text-admin-text-secondary">
                  <summary className="cursor-pointer font-semibold text-russian-violet">
                    Placeholders and formatting
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {placeholders.map((p) => (
                      <li key={p.key}>
                        <button
                          type="button"
                          onClick={() => insert(`{${p.key}}`)}
                          className="font-mono text-russian-violet hover:underline"
                        >
                          {`{${p.key}}`}
                        </button>{" "}
                        - {p.help}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2">
                    A blank line starts a new paragraph. A line that is only{" "}
                    <code>[Text](https://...)</code> becomes a big button.
                  </p>
                </details>
              )}
              {editable && (
                <p className="text-sm text-admin-muted" aria-live="polite">
                  {saveState === "saving" && "Saving..."}
                  {saveState === "saved" && "All changes saved."}
                  {saveState === "unsaved" && "Unsaved changes"}
                  {saveState === "error" && "Couldn't save. Keep this tab open and try again."}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Preview"
            description={preview ? `Subject: ${preview.subject}` : "Loading..."}
            actions={
              <div className="flex gap-1">
                {(["desktop", "phone"] as const).map((w) => (
                  <AdminButton
                    key={w}
                    size="xs"
                    variant={width === w ? "primary" : "secondary"}
                    onClick={() => setWidth(w)}
                  >
                    {w === "desktop" ? "Desktop" : "Phone"}
                  </AdminButton>
                ))}
              </div>
            }
          />
          {editable && templates.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              <label className="flex flex-col gap-1 text-sm font-medium text-admin-text">
                Template
                <select
                  value={templateId ?? ""}
                  onChange={(e) => applyTemplate(e.target.value)}
                  className={ADMIN_INPUT_CLS}
                >
                  {templateId === null && (
                    <option value="" disabled>
                      Pick a template
                    </option>
                  )}
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id === BLANK_TEMPLATE_ID ? "Blank" : t.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-admin-muted">
                Fields you&apos;ve changed stay as they are; the rest follow the template.
              </p>
            </div>
          )}
          {preview && preview.problems.length > 0 && (
            <ul className="mt-3 list-disc rounded-lg border border-amber-300 bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-900">
              {preview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-center rounded-lg bg-admin-bg p-2">
            <iframe
              srcDoc={preview?.html ?? ""}
              title="Email preview"
              sandbox=""
              className={cn(
                "h-[70vh] rounded-lg border border-admin-border bg-white",
                width === "desktop" ? "w-full" : "w-93.75 max-w-full",
              )}
            />
          </div>
        </Card>
      </div>

      {editable && (
        <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-xl border border-admin-border bg-admin-surface py-3 pr-20 pl-4 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:pr-4">
          <p className="text-sm text-admin-muted">
            {sendBlocked ??
              (initial.isPreset
                ? "Presets aren't sent. Use one from the Presets tab to start an email."
                : "Send a test first to check it on your phone.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <AdminButton
              variant="secondary"
              busy={busy === "test"}
              disabled={sendBlocked !== null}
              onClick={() => void sendTest()}
            >
              Send test to me
            </AdminButton>
            {!initial.isPreset && (
              <>
                <AdminButton
                  variant="secondary"
                  disabled={sendBlocked !== null}
                  onClick={() => void openDialog("schedule")}
                >
                  Schedule
                </AdminButton>
                <AdminButton disabled={sendBlocked !== null} onClick={() => void openDialog("now")}>
                  Send now
                </AdminButton>
              </>
            )}
          </div>
        </div>
      )}

      {sends.length > 0 && (
        <Card>
          <CardHeader
            title="Who it went to"
            description={`${sends.filter((s) => s.status === "sent").length} sent, ${failedCount} failed`}
            actions={
              failedCount > 0 && initial.status !== "sending" ? (
                <AdminButton busy={busy === "retry"} onClick={() => void retryFailed()}>
                  Retry failed
                </AdminButton>
              ) : undefined
            }
          />
          <ul className="mt-3 max-h-112 divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
            {sends.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-admin-text">{s.name}</p>
                  <p className="truncate text-sm text-admin-muted">{s.email}</p>
                  {s.error && <p className="text-sm text-red-700">{s.error}</p>}
                </div>
                <StatusPill tone={SEND_PILL[s.status].tone}>{SEND_PILL[s.status].label}</StatusPill>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!initial.isPreset && dialog && (
        <SendDialog
          open
          initialMode={dialog}
          campaign={initial}
          quiet={quiet}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Labelled form field.
 * @param props - Component props.
 * @param props.label - Field label.
 * @param props.children - The input.
 * @returns Field element.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-admin-text">
      {label}
      {children}
    </label>
  );
}

/**
 * Explains a locked email: scheduled, sending, sent or failed.
 * @param props - Component props.
 * @param props.campaign - The email.
 * @param props.busy - Which action is running.
 * @param props.onCancelSchedule - Cancels a schedule.
 * @param props.onRefresh - Reloads the page data.
 * @returns Banner element, or null for drafts and presets.
 */
function StatusBanner({
  campaign,
  busy,
  onCancelSchedule,
  onRefresh,
}: {
  campaign: CampaignRow;
  busy: string | null;
  onCancelSchedule: () => void;
  onRefresh: () => void;
}): React.ReactElement | null {
  if (campaign.isPreset || campaign.status === "draft") return null;
  const box =
    "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm";

  if (campaign.status === "scheduled") {
    return (
      <div className={cn(box, "border-sky-300 bg-sky-50 text-sky-900")}>
        <span>
          Sends {campaign.scheduledAt ? formatDateTimeShort(campaign.scheduledAt) : "soon"}. Cancel
          the schedule to make changes.
        </span>
        <AdminButton
          size="sm"
          variant="secondary"
          busy={busy === "unschedule"}
          onClick={onCancelSchedule}
        >
          Cancel schedule
        </AdminButton>
      </div>
    );
  }
  if (campaign.status === "sending") {
    return (
      <div className={cn(box, "border-amber-300 bg-amber-50 text-amber-900")}>
        <span>Sending now. Anything left over is picked up automatically within 15 minutes.</span>
        <AdminButton size="sm" variant="secondary" onClick={onRefresh}>
          Refresh
        </AdminButton>
      </div>
    );
  }
  return (
    <div
      className={cn(
        box,
        campaign.status === "sent"
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-red-300 bg-red-50 text-red-900",
      )}
    >
      <span>
        {campaign.status === "sent" ? "Sent" : "Nothing went out"}
        {campaign.sentAt && ` ${formatDateTimeShort(campaign.sentAt)}`} - {campaign.sentCount} sent
        {campaign.failedCount > 0 && `, ${campaign.failedCount} failed`}. Duplicate it from the
        Mailing page to send something similar.
      </span>
    </div>
  );
}
