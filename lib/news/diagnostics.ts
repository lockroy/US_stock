export async function inspectGoogleFailure(response: Response) {
  const contentType = response.headers.get("content-type")?.slice(0, 80) ?? "unknown";
  let text = "";
  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let remaining = 8192;
    try {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done) break;
        const part = value.subarray(0, remaining);
        text += decoder.decode(part, { stream: true });
        remaining -= part.byteLength;
      }
    } catch { /* 錯誤頁也可能讀取失敗；保留已知狀態。 */ }
    finally {
      try { await reader.cancel(); } catch { /* 已中斷 */ }
      reader.releaseLock();
    }
  }
  const hint = /unusual traffic|automated queries|automated requests|recaptcha|captcha|\/sorry\//i.test(text)
    ? "automated_request_notice"
    : /consent\.google\.com|before you continue to google/i.test(text) ? "consent_notice"
      : /service unavailable|temporarily unavailable|server error|overloaded/i.test(text) ? "server_unavailable_notice"
        : "unclassified";
  const retry = response.headers.get("retry-after");
  return { upstreamStatus: response.status, contentType, hint,
    ...(retry && /^\d{1,6}$/.test(retry) ? { retryAfterSeconds: Number(retry) } : {}) };
}
