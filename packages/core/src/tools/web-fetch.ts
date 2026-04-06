import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  url: z.string().url().describe("URL to fetch"),
  prompt: z.string().optional().describe("If provided, extract only information relevant to this prompt"),
  maxLength: z.number().optional().default(10000).describe("Max characters to return"),
});

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export const WebFetchTool: Tool = {
  name: "WebFetch",
  description: "Fetch the content of a URL and return it as plain text.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      prompt: { type: "string", description: "Optional: what to extract from the page" },
      maxLength: { type: "number", description: "Max characters to return", default: 10000 },
    },
    required: ["url"],
  },
  requiresPermission: true,

  async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { url, maxLength } = parsed.data;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "SuperCode/0.1.0 (github.com/jbellsolutions/supercode)",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return {
          success: false,
          output: "",
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      let text: string;

      if (contentType.includes("text/html")) {
        const html = await response.text();
        text = htmlToText(html);
      } else {
        text = await response.text();
      }

      const trimmed = text.slice(0, maxLength);
      return {
        success: true,
        output: trimmed + (text.length > maxLength ? `\n\n[Truncated — showing ${maxLength} of ${text.length} chars]` : ""),
      };
    } catch (err: unknown) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
