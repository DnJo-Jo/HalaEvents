"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import type { FormState } from "@/lib/forms";
import { checkbox } from "@/lib/schemas/common";
import {
  DocumentInput,
  DocumentReviewInput,
  ModerationDecisionInput,
  ProviderProfileInput,
  ServiceInput,
  VenueProfileInput,
  VerificationDecisionInput,
} from "./schemas";
import * as service from "./providers-service";

// Bound arguments (provider/service/document ids) come from the server-rendered page but are
// still untrusted: they are validated here and authorized in the service.
const Id = z.uuid();

export async function createProviderAction(_prev: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const result = await runAction(ProviderProfileInput, formFields(form), async (data) => {
    id = await service.createProvider(data);
  });
  if (result.ok && id) redirect(`/app/provider/${id}`);
  return result;
}

export async function updateProviderAction(providerId: string, _prev: FormState, form: FormData) {
  return runAction(ProviderProfileInput, formFields(form), async (data) => {
    await service.updateProvider(Id.parse(providerId), data);
    return "Profile saved.";
  });
}

export async function setListedAction(
  providerId: string,
  listed: boolean,
  _prev: FormState,
  _form: FormData,
) {
  return runAction(z.object({}), {}, async () => {
    await service.setListed(Id.parse(providerId), listed);
    return listed
      ? "Listing is visible again (once verified)."
      : "Listing paused. It's hidden from the marketplace.";
  });
}

export async function saveVenueAction(providerId: string, _prev: FormState, form: FormData) {
  return runAction(
    VenueProfileInput,
    formFields(form, ["accessibility", "suitability"]),
    async (data) => {
      await service.saveVenue(Id.parse(providerId), data);
      return "Venue details saved.";
    },
  );
}

export async function addServiceAction(providerId: string, _prev: FormState, form: FormData) {
  const raw = formFields(form);
  return runAction(
    ServiceInput,
    { ...raw, isActive: checkbox.parse(raw.isActive ?? "on") },
    async (data) => {
      await service.addService(Id.parse(providerId), data);
      return "Service added.";
    },
  );
}

export async function setServiceActiveAction(
  providerId: string,
  serviceId: string,
  active: boolean,
  _prev: FormState,
  _form: FormData,
) {
  return runAction(z.object({}), {}, async () => {
    await service.setServiceActive(Id.parse(providerId), Id.parse(serviceId), active);
    return active ? "Service shown." : "Service hidden.";
  });
}

export async function deleteServiceAction(
  providerId: string,
  serviceId: string,
  _prev: FormState,
  _form: FormData,
) {
  return runAction(z.object({}), {}, async () => {
    await service.deleteService(Id.parse(providerId), Id.parse(serviceId));
    return "Service deleted.";
  });
}

export async function addDocumentAction(providerId: string, _prev: FormState, form: FormData) {
  return runAction(DocumentInput, formFields(form), async (data) => {
    await service.addDocument(Id.parse(providerId), data);
    return "Credential recorded. An admin will review it.";
  });
}

export async function deleteDocumentAction(
  providerId: string,
  documentId: string,
  _prev: FormState,
  _form: FormData,
) {
  return runAction(z.object({}), {}, async () => {
    await service.deleteDocument(Id.parse(providerId), Id.parse(documentId));
    return "Credential removed.";
  });
}

export async function submitForVerificationAction(
  providerId: string,
  _prev: FormState,
  _form: FormData,
) {
  return runAction(z.object({}), {}, async () => {
    await service.submitForVerification(Id.parse(providerId));
    return "Submitted for review. You'll see the decision here.";
  });
}

export async function decideVerificationAction(
  providerId: string,
  _prev: FormState,
  form: FormData,
) {
  return runAction(VerificationDecisionInput, formFields(form), async (d) => {
    await service.decideVerification(Id.parse(providerId), d.decision, d.note);
    return d.decision === "verified" ? "Provider verified." : "Provider rejected.";
  });
}

export async function moderateAction(providerId: string, _prev: FormState, form: FormData) {
  return runAction(ModerationDecisionInput, formFields(form), async (d) => {
    await service.moderate(Id.parse(providerId), d.status, d.reason);
    return "Moderation updated.";
  });
}

export async function reviewDocumentAction(documentId: string, _prev: FormState, form: FormData) {
  return runAction(DocumentReviewInput, formFields(form), async (d) => {
    await service.reviewDocument(Id.parse(documentId), d.decision, d.note);
    return d.decision === "accepted" ? "Credential accepted." : "Credential rejected.";
  });
}
