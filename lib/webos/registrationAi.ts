import "server-only";

import { assertCanPerform, type AccessContext } from "@/lib/webos/access";

export type RegistrationDraft = {
  fullName: string;
  fatherHusbandName: string;
  phone: string;
  alternativePhone: string;
  age: string;
  gender: "Male" | "Female" | "";
  address: string;
  diagnosis: string;
  referral: string;
  remarks: string;
};

type Department = "Physio" | "Dental";

const MAX_IMAGE_DATA_URL_LENGTH = 6_500_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function clean(value: unknown, max = 240): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI_EXTRACTION_INVALID_RESPONSE");
  try {
    return JSON.parse(withoutFence.slice(first, last + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("AI_EXTRACTION_INVALID_RESPONSE");
  }
}

function normalizeDraft(raw: Record<string, unknown>): RegistrationDraft {
  const genderRaw = clean(raw.gender, 20).toLowerCase();
  const gender: RegistrationDraft["gender"] =
    genderRaw === "male" || genderRaw === "m" || genderRaw === "পুরুষ"
      ? "Male"
      : genderRaw === "female" || genderRaw === "f" || genderRaw === "মহিলা" || genderRaw === "নারী"
        ? "Female"
        : "";
  const ageRaw = clean(raw.age, 12);
  const ageMatch = ageRaw.match(/\d{1,3}/);

  return {
    fullName: clean(raw.fullName, 120),
    fatherHusbandName: clean(raw.fatherHusbandName, 120),
    phone: clean(raw.phone, 32).replace(/[^\d+]/g, ""),
    alternativePhone: clean(raw.alternativePhone, 32).replace(/[^\d+]/g, ""),
    age: ageMatch ? ageMatch[0] : "",
    gender,
    address: clean(raw.address, 280),
    diagnosis: clean(raw.diagnosis, 500),
    referral: clean(raw.referral, 160),
    remarks: clean(raw.remarks, 500),
  };
}

export async function extractRegistrationDraftFromImage(
  context: AccessContext,
  input: { department: Department; imageDataUrl: string }
): Promise<{ draft: RegistrationDraft; provider: "openrouter_vision" }> {
  assertCanPerform(context, "patient.create", input.department);

  const imageDataUrl = String(input.imageDataUrl || "").trim();
  if (!IMAGE_DATA_URL.test(imageDataUrl) || imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("INVALID_REGISTRATION_IMAGE");
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const model =
    process.env.OPENROUTER_VISION_MODEL_NAME?.trim() ||
    process.env.OPENROUTER_MODEL_NAME?.trim() ||
    "openai/gpt-4o-mini";

  const system = [
    "You extract patient-registration fields from a clinic prescription, report, referral note, ID-style document, or handwritten/printed registration source.",
    "Return ONLY one JSON object. Never invent or infer a value that is not visibly supported by the image.",
    "Unknown or uncertain fields must be empty strings.",
    "Do not diagnose from an image. diagnosis may contain only an explicitly written diagnosis/complaint/referral indication visible in the document.",
    "Normalize gender only when explicitly visible as Male/Female or an unambiguous equivalent.",
    "Phone is allowed to be empty. Dental phone is optional.",
    "This output is only a draft for human review and must never create a patient automatically.",
  ].join("\n");
  const prompt = [
    `Department: ${input.department}`,
    "Extract these exact JSON keys:",
    '{"fullName":"","fatherHusbandName":"","phone":"","alternativePhone":"","age":"","gender":"","address":"","diagnosis":"","referral":"","remarks":""}',
    "Preserve names/addresses as written where legible. Do not add commentary outside JSON.",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 700,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("Registration image extraction provider error", response.status);
      throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = payload.choices?.[0]?.message?.content;
    if (!answer) throw new Error("AI_EMPTY_RESPONSE");
    return { draft: normalizeDraft(parseJsonObject(answer)), provider: "openrouter_vision" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI_PROVIDER_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
