"use server";

import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import type { FormState } from "@/lib/forms";
import {
  ModerateInput,
  ReportInput,
  ResolveInput,
  ResponseInput,
  ReviewInput,
  SettingInput,
} from "./schemas";
import * as service from "./service";

const Id = z.uuid();
const unknown = { ok: false, message: "Unknown item." } satisfies FormState;

export async function submitReviewAction(_prev: FormState, form: FormData) {
  return runAction(ReviewInput, formFields(form), async (d) => {
    await service.submitReview(d);
    return "Thank you. Your review is published.";
  });
}

export async function respondAction(reviewId: string, _prev: FormState, form: FormData) {
  if (!Id.safeParse(reviewId).success) return unknown;
  return runAction(ResponseInput, formFields(form), async (d) => {
    await service.respondToReview(reviewId, d.body);
    return "Response published.";
  });
}

export async function reportAction(reviewId: string, _prev: FormState, form: FormData) {
  if (!Id.safeParse(reviewId).success) return unknown;
  return runAction(ReportInput, formFields(form), async (d) => {
    await service.reportReview(reviewId, d);
    return d.kind === "dispute"
      ? "Dispute sent to the platform administrators."
      : "Thank you. The report was sent to the platform administrators.";
  });
}

export async function moderateAction(reviewId: string, _prev: FormState, form: FormData) {
  if (!Id.safeParse(reviewId).success) return unknown;
  return runAction(ModerateInput, formFields(form), async (d) => {
    await service.moderateReview(reviewId, d.status, d.note);
    return d.status === "hidden" ? "Review hidden." : "Review restored.";
  });
}

export async function resolveReportAction(reportId: string, _prev: FormState, form: FormData) {
  if (!Id.safeParse(reportId).success) return unknown;
  return runAction(ResolveInput, formFields(form), async (d) => {
    await service.resolveReviewReport(reportId, d);
    return "Report resolved.";
  });
}

export async function setProviderReviewsAction(_prev: FormState, form: FormData) {
  return runAction(SettingInput, formFields(form), async (d) => {
    await service.setProviderReviews(d.enabled);
    return d.enabled
      ? "Providers can now review organizers."
      : "Providers can no longer write new reviews of organizers.";
  });
}
