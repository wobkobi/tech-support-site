"use client";
// src/features/mailing/components/CampaignPreviewCard.tsx
// The editor's preview card: the rendered email in a sandboxed frame at desktop or phone
// width, the template dropdown on a draft, and any problems the renderer found. The
// frame shows the server's real email HTML, so it keeps a white canvas like an inbox.

import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { BLANK_TEMPLATE_ID, type Template } from "@/features/mailing/lib/templates";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId } from "react";

/** The preview route's answer. */
export interface CampaignPreview {
  html: string;
  subject: string;
  problems: string[];
}

/**
 * Preview card for the email editor.
 * @param props - Component props.
 * @param props.preview - Latest rendered preview, or undefined while the first one loads.
 * @param props.width - Frame width: desktop or phone.
 * @param props.onWidth - Switches the frame width.
 * @param props.showTemplates - Whether the template dropdown shows (drafts with templates).
 * @param props.templates - Templates for the dropdown.
 * @param props.templateId - Template the fields currently match, or null.
 * @param props.onTemplate - Applies a template by id.
 * @returns Preview card element.
 */
export function CampaignPreviewCard({
  preview,
  width,
  onWidth,
  showTemplates,
  templates,
  templateId,
  onTemplate,
}: {
  preview: CampaignPreview | undefined;
  width: "desktop" | "phone";
  onWidth: (w: "desktop" | "phone") => void;
  showTemplates: boolean;
  templates: Template[];
  templateId: string | null;
  onTemplate: (id: string) => void;
}): React.ReactElement {
  const templateFieldId = useId();
  return (
    <Card>
      <CardHeader
        title="Preview"
        description={preview ? `Subject: ${preview.subject}` : "Loading..."}
        actions={
          <div className="inline-flex rounded-lg border border-admin-border bg-admin-bg p-0.5">
            {(["desktop", "phone"] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={width === w}
                onClick={() => onWidth(w)}
                className={cn(
                  "h-9 rounded-md px-3 text-sm font-semibold transition-colors",
                  width === w
                    ? "bg-russian-violet text-white"
                    : "text-admin-text-secondary hover:bg-admin-surface",
                )}
              >
                {w === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
        }
      />
      {showTemplates && (
        <AdminField
          label="Template"
          htmlFor={templateFieldId}
          hint={<>Fields you&apos;ve changed stay as they are; the rest follow the template.</>}
          className="mt-3"
        >
          <AdminSelect
            id={templateFieldId}
            value={templateId ?? ""}
            onChange={(e) => onTemplate(e.target.value)}
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
          </AdminSelect>
        </AdminField>
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
  );
}
