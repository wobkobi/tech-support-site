"use client";
// src/features/contacts/components/NewContactModal.tsx
// Add a contact by hand from the Contacts page. Saves through POST /api/admin/contacts, which
// matches an existing contact by email (or mobile when there's no email) and pushes a new one to
// Google Contacts.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { combineUnitAndAddress } from "@/features/booking/lib/booking";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { useRouter } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";

/**
 * Dialog for adding a contact by hand. On save it opens the contact: the new one, or the
 * existing one the email or mobile already belongs to.
 * @param props - Component props.
 * @param props.onClose - Called when the dialog closes without saving.
 * @returns Modal element.
 */
export function NewContactModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [unit, setUnit] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  // State lags a render, so two presses in one tick would both read saving as false.
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  /** Validates, saves, then opens the saved contact. */
  async function handleSave(): Promise<void> {
    // The button and Enter both submit; a second press while saving would create a twin.
    if (savingRef.current) return;
    if (!name.trim()) {
      setError("Add a name.");
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setError("Add an email or a mobile number.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim() || null,
          email: email.trim(),
          phone: phone.trim() || null,
          address: combineUnitAndAddress(unit, address) || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: boolean;
        emailAttached?: boolean;
        contact?: { id?: string; name?: string };
      };
      if (!res.ok || !data.contact?.id) {
        throw new Error(data.error ?? "Couldn't save the contact.");
      }
      // An email or mobile already on file returns that contact unchanged; say so, since
      // nothing typed here was saved to it.
      if (data.created) {
        toast("Contact saved.", { tone: "success" });
      } else if (data.emailAttached) {
        toast(`Email added to ${data.contact.name ?? "the existing contact"}.`, {
          tone: "success",
        });
      } else {
        toast(`Already in your contacts as ${data.contact.name ?? "another contact"}.`);
      }
      router.push(`/admin/contacts/${data.contact.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the contact.");
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New contact"
      placement="top"
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </AdminButton>
          <AdminButton variant="primary" onClick={() => void handleSave()} busy={saving}>
            Save contact
          </AdminButton>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <AdminField label="Name" htmlFor="nc-name" required>
          <AdminInput
            id="nc-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoComplete="off"
            disabled={saving}
          />
        </AdminField>
        <AdminField label="Company" htmlFor="nc-company" optional>
          <AdminInput
            id="nc-company"
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={200}
            autoComplete="off"
            disabled={saving}
          />
        </AdminField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AdminField label="Phone" htmlFor="nc-phone" optional>
            <PhoneInput
              id="nc-phone"
              value={phone}
              onChange={setPhone}
              className={ADMIN_INPUT_CLS}
              disabled={saving}
            />
          </AdminField>
          <AdminField label="Email" htmlFor="nc-email" optional>
            <EmailInput
              id="nc-email"
              value={email}
              onChange={setEmail}
              maxLength={320}
              className={ADMIN_INPUT_CLS}
            />
          </AdminField>
        </div>
        {/* Stack below sm, address first: unit + autocomplete can't fit three tracks on a phone,
            and the unit is typed after the address is picked. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AdminField label="Apt / Unit" htmlFor="nc-unit" optional>
            <AdminInput
              id="nc-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              autoComplete="off"
              maxLength={20}
              disabled={saving}
            />
          </AdminField>
          <div className="max-sm:order-first sm:col-span-2">
            <AdminField label="Address" htmlFor="nc-address" optional>
              <AddressAutocomplete
                id="nc-address"
                value={address}
                onChange={setAddress}
                placeholder="Street address"
                maxLength={250}
                inputClassName={ADMIN_INPUT_CLS}
              />
            </AdminField>
          </div>
        </div>
        <p className="text-sm text-admin-muted">
          Needs an email or a mobile number. It&apos;s added to Google Contacts too.
        </p>
        {error && (
          <p role="alert" className="text-sm text-coquelicot-500">
            {error}
          </p>
        )}
        {/* Lets Enter in a field submit the form. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
