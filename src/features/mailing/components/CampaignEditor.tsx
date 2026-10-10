"use client";
// src/features/mailing/components/CampaignEditor.tsx
// Write, preview and send one mailing-list email. Drafts and presets autosave; the
// preview is rendered by the same server code that builds the real email, so what
// shows here is exactly what lands. Once an email is scheduled or sent the content
// locks and the page shows who it went to instead. Drafts get a template dropdown
// beside the preview that swaps presets while keeping any field already edited, and
// the body has an Add menu for placeholders, links, buttons and contact details.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import { InsertMenu, type InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  CampaignPreviewCard,
  type CampaignPreview,
} from "@/features/mailing/components/CampaignPreviewCard";
import { CampaignSendsCard } from "@/features/mailing/components/CampaignSendsCard";
import { CampaignStatusBanner } from "@/features/mailing/components/CampaignStatusBanner";
import { SendDialog, type SendMode } from "@/features/mailing/components/SendDialog";
import { callApi } from "@/features/mailing/lib/api-client";
import { AUDIENCE_OPTIONS, type CampaignAudience } from "@/features/mailing/lib/audience";
import type { CampaignRow } from "@/features/mailing/lib/campaign-row";
import { matchTemplate, switchTemplate, type Template } from "@/features/mailing/lib/templates";
import type { QuietHours } from "@/shared/lib/quiet-hours";
import { shrinkImage } from "@/shared/lib/resize-image";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

/** One recipient's copy of a sent email. */
export interface SendRow {
  id: string;
  name: string;
  email: string;
  status: "pending" | "sent" | "failed";
  error: string | null;
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
 * @param props.insertGroups - What the Add menu offers.
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
  insertGroups,
  missingEnv,
  canUpload,
  quiet,
  promoTitle,
  adminEmail,
  templates,
}: {
  initial: CampaignRow;
  sends: SendRow[];
  insertGroups: InsertGroup[];
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
  const [audience, setAudience] = useState<CampaignAudience>(initial.audience);
  const [templateId, setTemplateId] = useState(() => matchTemplate(content, templates));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saved = useRef<Content>(content);
  const saving = useRef<Promise<boolean> | null>(null);

  const [preview, setPreview] = useState<CampaignPreview>();
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SendMode | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

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
          audience,
        },
      ).then((res) => {
        if (seq !== previewSeq.current) return;
        if (res.ok) setPreview({ html: res.html, subject: res.subject, problems: res.problems });
      });
    }, PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [content.subject, content.preheader, content.body, promoId, audience]);

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
   * @param line - Give it a line of its own. A button only renders as one when nothing
   * else shares its line, so text after the cursor moves down too.
   */
  function insert(before: string, after = "", line = false): void {
    const el = bodyRef.current;
    const body = content.body;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const lead = line && start > 0 && body[start - 1] !== "\n" ? "\n" : "";
    const trail = line && end < body.length && body[end] !== "\n" ? "\n" : "";
    const next = body.slice(0, start) + lead + before + selected + after + trail + body.slice(end);
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
      const { file: small } = await shrinkImage(file);
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

  /**
   * Saves who the email goes to straight away, like the promo link, rather than through
   * the text autosave.
   * @param next - The picked audience.
   */
  async function changeAudience(next: CampaignAudience): Promise<void> {
    const before = audience;
    setAudience(next);
    const res = await callApi(`/api/admin/mailing/${initial.id}`, "PATCH", { audience: next });
    if (!res.ok) {
      setAudience(before);
      toast(res.error, { tone: "error" });
    }
  }

  /** Detaches the email from its promo, so it describes whatever promo is running. */
  async function unlinkPromo(): Promise<void> {
    setBusy("unlink");
    const res = await callApi(`/api/admin/mailing/${initial.id}`, "PATCH", { promoId: null });
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    else setPromoId(null);
  }

  /** Starts a social post from this email's text, button link and first picture. */
  async function shareToSocial(): Promise<void> {
    if (editable && !(await save())) return;
    setBusy("share");
    const res = await callApi<{ post: { id: string } }>("/api/admin/social", "POST", {
      source: "campaign",
      campaignId: initial.id,
    });
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/social?post=${res.post.id}`);
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
      <CampaignStatusBanner
        campaign={initial}
        busy={busy}
        onCancelSchedule={() => void cancelSchedule()}
        onRefresh={() => router.refresh()}
      />

      {!initial.isPreset && (
        <div className="flex justify-end">
          <AdminButton
            size="sm"
            variant="secondary"
            busy={busy === "share"}
            onClick={() => void shareToSocial()}
          >
            Share to social
          </AdminButton>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="flex flex-col gap-4">
            <AdminField
              label={initial.isPreset ? "Preset name" : "Name (only you see this)"}
              htmlFor={`${fieldId}-name`}
            >
              <AdminInput
                id={`${fieldId}-name`}
                value={content.name}
                onChange={(e) => setField("name", e.target.value)}
                disabled={!editable}
                maxLength={120}
              />
            </AdminField>
            <AdminField label="Subject" htmlFor={`${fieldId}-subject`}>
              <AdminInput
                id={`${fieldId}-subject`}
                value={content.subject}
                onChange={(e) => setField("subject", e.target.value)}
                disabled={!editable}
                maxLength={200}
              />
            </AdminField>
            <AdminField
              label="Preview text (shows after the subject in most inboxes)"
              htmlFor={`${fieldId}-preheader`}
            >
              <AdminInput
                id={`${fieldId}-preheader`}
                value={content.preheader}
                onChange={(e) => setField("preheader", e.target.value)}
                disabled={!editable}
                maxLength={200}
              />
            </AdminField>

            <AdminField label="Who it goes to" htmlFor={`${fieldId}-audience`}>
              <AdminSelect
                id={`${fieldId}-audience`}
                value={audience}
                onChange={(e) => void changeAudience(e.target.value as CampaignAudience)}
                disabled={!editable}
              >
                {AUDIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </AdminSelect>
            </AdminField>

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
              <label htmlFor={`${fieldId}-body`} className={ADMIN_LABEL_CLS}>
                Email
              </label>
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
                  <div className="ml-auto">
                    <InsertMenu
                      groups={insertGroups}
                      onInsert={(text, line) => insert(text, "", line)}
                      align="right"
                    />
                  </div>
                </div>
              )}
              <AdminTextarea
                ref={bodyRef}
                id={`${fieldId}-body`}
                value={content.body}
                onChange={(e) => setField("body", e.target.value)}
                disabled={!editable}
                rows={18}
                className="font-mono text-sm leading-relaxed"
              />
              {editable && (
                <details className="text-sm text-admin-text-secondary">
                  <summary className="cursor-pointer font-semibold text-russian-violet">
                    Formatting help
                  </summary>
                  <p className="mt-2">
                    A blank line starts a new paragraph. A line that is only{" "}
                    <code>[Text](https://...)</code> becomes a big button.
                  </p>
                  <p className="mt-2">
                    Words in curly brackets, like <code>{"{firstName}"}</code>, fill in for each
                    person. Add lists them all, with links, buttons and contact details.
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

        <CampaignPreviewCard
          preview={preview}
          width={width}
          onWidth={setWidth}
          showTemplates={editable && templates.length > 0}
          templates={templates}
          templateId={templateId}
          onTemplate={applyTemplate}
        />
      </div>

      {editable && (
        <div
          data-phone-bar="sticky"
          className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-lg border border-admin-border bg-admin-surface py-3 pr-20 pl-4 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:pr-4"
        >
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
        <CampaignSendsCard
          sends={sends}
          failedCount={failedCount}
          status={initial.status}
          retrying={busy === "retry"}
          onRetry={() => void retryFailed()}
        />
      )}

      {!initial.isPreset && dialog && (
        <SendDialog
          open
          initialMode={dialog}
          campaign={{ ...initial, audience }}
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
