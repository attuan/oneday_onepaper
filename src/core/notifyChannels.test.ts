import { describe, expect, it, vi } from "vitest";
import { isSlackWebhookUrl, linePayload, messageText, sendLine, sendSlack, slackPayload } from "./notifyChannels";

const okFetch = (init: ResponseInit = { status: 200 }) => vi.fn(async () => new Response("ok", init)) as unknown as typeof fetch;

describe("文面", () => {
  it("タイトルと本文を 2 行にする。本文が無ければタイトルだけ", () => {
    expect(messageText("今日の論文", "Attention Is All You Need")).toBe("今日の論文\nAttention Is All You Need");
    expect(messageText("締切まで 30 分", "")).toBe("締切まで 30 分");
  });
  it("Slack と LINE の JSON", () => {
    expect(slackPayload("a", "b")).toEqual({ text: "a\nb" });
    expect(linePayload("U123", "a", "b")).toEqual({ to: "U123", messages: [{ type: "text", text: "a\nb" }] });
  });
});

describe("isSlackWebhookUrl", () => {
  it("hooks.slack.com/services/ 以下の https だけ", () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/xxxx")).toBe(true);
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/T000/B000/xxxx")).toBe(false);
    expect(isSlackWebhookUrl("https://example.com/services/x")).toBe(false);
    expect(isSlackWebhookUrl("https://hooks.slack.com/other")).toBe(false);
    expect(isSlackWebhookUrl("not a url")).toBe(false);
  });
});

describe("sendSlack", () => {
  it("JSON を POST する", async () => {
    const f = okFetch();
    await sendSlack(f, "https://hooks.slack.com/services/T/B/x", "t", "b");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "t\nb" });
  });
  it("URL の形式が違えば送らない", async () => {
    const f = okFetch();
    await expect(sendSlack(f, "https://evil.example/services/x", "t", "b")).rejects.toThrow(/形式/);
    expect(f).not.toHaveBeenCalled();
  });
  it("失敗の応答はエラーにする。opaque(no-cors)は成功扱い", async () => {
    await expect(sendSlack(okFetch({ status: 404 }), "https://hooks.slack.com/services/T/B/x", "t", "b")).rejects.toThrow(/HTTP 404/);
    const opaque = vi.fn(async () => Response.error()) as unknown as typeof fetch; // type は "error" だが opaque と同じく ok=false
    await expect(sendSlack(opaque, "https://hooks.slack.com/services/T/B/x", "t", "b")).rejects.toThrow();
    const opaqueRes = { type: "opaque", ok: false, status: 0, text: async () => "" } as unknown as Response;
    await sendSlack(vi.fn(async () => opaqueRes) as unknown as typeof fetch, "https://hooks.slack.com/services/T/B/x", "t", "b");
  });
});

describe("sendLine", () => {
  it("Bearer トークン付きで push API に POST する", async () => {
    const f = okFetch();
    await sendLine(f, " tok ", "U1", "t", "b");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ to: "U1", messages: [{ type: "text", text: "t\nb" }] });
  });
  it("トークンや送信先が無ければ送らない", async () => {
    const f = okFetch();
    await expect(sendLine(f, "", "U1", "t", "b")).rejects.toThrow(/トークン/);
    await expect(sendLine(f, "tok", "", "t", "b")).rejects.toThrow(/送信先/);
    expect(f).not.toHaveBeenCalled();
  });
  it("失敗の応答は本文を添えてエラーにする", async () => {
    await expect(sendLine(okFetch({ status: 401 }), "tok", "U1", "t", "b")).rejects.toThrow(/HTTP 401: ok/);
  });
});
