import { assertSameOrigin } from "@/lib/server/ai-guard";
import { reserveAiCall } from "@/lib/server/ai-budget";
import { extractDocumentServer, MAX_DOCUMENT_BYTES } from "@/lib/server/extraction";
import { apiError, handle, json } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";

export const maxDuration = 60;

export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_DOCUMENT_BYTES + 64 * 1024) {
    return apiError(413, "FILE_TOO_LARGE", "The file is larger than 3 MB. Upload a smaller file or enter the figures manually.");
  }
  if (rateLimited(request, "extract", 12, 60_000)) {
    return apiError(429, "RATE_LIMITED", "Too many documents in a short time. Wait a minute or enter the figures manually.");
  }
  let form: FormData;
  try { form = await request.formData(); } catch {
    return apiError(400, "MALFORMED_UPLOAD", "Upload one file in a form field named \"file\".");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "MALFORMED_UPLOAD", "Upload one file in a form field named \"file\".");
  const { status, result } = await extractDocumentServer({
    bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, name: file.name,
    consentToProvider: form.get("consent") === "provider",
    authorizeProvider: estimate => reserveAiCall(request, "extraction", estimate),
  });
  return json(result, status);
});
