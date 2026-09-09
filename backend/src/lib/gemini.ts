import { GoogleGenAI, Type } from "@google/genai";
import { env, geminiConfigured } from "./env.js";

export { geminiConfigured };

// PRD §30.8 — AI-assisted content moderation. Deliberately autonomous, not a
// triage/flagging layer: the product decision here (explicit, not the PRD's
// original "human still decides" framing) is that Gemini's decision executes
// directly — there is no moderator role/queue in this codebase to hand off to
// (§14's role system was never built; see docs/backend-conventions.md and
// every prior "moderator-only" gap flagged across reviews/rooms). Every
// action taken is still soft/reversible per this project's general policy
// (soft-delete, time-boxed status where possible), not a one-way door.

export type ModerationCategory =
  | "sexual-solicitation"
  | "harassment"
  | "private-content-sharing"
  | "grooming"
  | "spam-or-scam"
  | "legitimate-discussion"
  | "other";

export type ContentAction = "none" | "remove";

// Maps onto PRD §30.6's 5-rung ladder (warning -> content removal -> temporary
// restriction -> temporary suspension -> permanent suspension). "Content
// removal" is modeled as the separate `contentAction` axis above rather than
// a rung here, since a single decision can independently remove content
// and/or act on the account (e.g. remove + warn, or remove + suspend) —
// truer to how a real moderation call works than a single linear step.
export type AccountAction = "none" | "warn" | "restrict" | "suspend_temporary" | "suspend_permanent";

export interface ModerationDecision {
  violates: boolean;
  category: ModerationCategory;
  contentAction: ContentAction;
  accountAction: AccountAction;
  suspensionDays: number | null; // only meaningful for "restrict" / "suspend_temporary"
  confidence: number; // 0-1
  rationale: string; // shown to the reporter and stored on the report for audit
}

export interface ModerationInput {
  targetType: "message" | "review" | "user" | "event";
  content: string; // the actual reported text (message/review text, event title+description, profile display name, ...)
  reportReason: string; // what the reporter said was wrong
}

// gemini-2.5-flash was retired for new API keys (discovered live, 2026-08-29 —
// after this codebase's knowledge cutoff): the API itself now points callers
// at gemini-3.6-flash as the direct replacement.
const MODEL = "gemini-3.6-flash";

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    violates: { type: Type.BOOLEAN },
    category: {
      type: Type.STRING,
      enum: ["sexual-solicitation", "harassment", "private-content-sharing", "grooming", "spam-or-scam", "legitimate-discussion", "other"]
    },
    contentAction: { type: Type.STRING, enum: ["none", "remove"] },
    accountAction: { type: Type.STRING, enum: ["none", "warn", "restrict", "suspend_temporary", "suspend_permanent"] },
    suspensionDays: { type: Type.INTEGER, nullable: true },
    confidence: { type: Type.NUMBER },
    rationale: { type: Type.STRING }
  },
  required: ["violates", "category", "contentAction", "accountAction", "suspensionDays", "confidence", "rationale"]
};

// Faithful to PRD §30.2's exact prohibited-behavior list and §30.8's core
// distinction (a movie's own sexual-assault subplot vs. an actual real-world
// solicitation happening in the room).
const SYSTEM_PROMPT = `You are ZATLAN's autonomous content moderator for a social movie platform. You review reported content and decide what happens next — there is no human reviewer after you; your decision is final and executes automatically. Be careful and conservative: false accusations harm real users.

ZATLAN prohibits: sexting/sexually explicit conversation; soliciting or requesting sexual content; sharing sexually explicit media; sexual solicitation or prostitution; using ZATLAN as a dating/hookup platform; unwanted sexual advances or harassment; sexual comments directed at other users; sharing another person's private/intimate content without consent; grooming or sexual exploitation of minors; spam, scams, or malicious solicitation; and general harassment or hate speech.

ZATLAN explicitly ALLOWS normal discussion of movies containing sexual themes, violence, or other mature content (e.g. discussing a film's assault subplot, a director's explicit scenes, or a controversial plot point) — this is legitimate and must not be flagged just because the *movie* is about a difficult topic. Judge whether the reported content is actually a violation happening between real people, not whether the underlying movie topic is mature.

Decide:
- violates: is this actually a policy violation (not just a report about ordinary movie discussion)?
- category: the best-fitting category, or "legitimate-discussion" if it doesn't violate anything, or "other" for a violation that doesn't fit the listed categories.
- contentAction: "remove" if the content itself should be taken down, else "none".
- accountAction: pick the lightest action that fits — "none" for no violation, "warn" for a first/minor issue, "restrict" for a clearer but not severe violation, "suspend_temporary" for a serious violation, "suspend_permanent" only for severe violations (e.g. grooming, exploitation, repeated serious harassment).
- suspensionDays: a reasonable number of days for "restrict" or "suspend_temporary" (e.g. 3-30), null otherwise.
- confidence: your confidence in this decision, 0 to 1.
- rationale: one or two sentences a real person could read and understand why this decision was made.`;

function buildPrompt(input: ModerationInput): string {
  return `Reported content type: ${input.targetType}\nReporter's stated reason: ${input.reportReason}\n\nReported content:\n"""\n${input.content}\n"""`;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return client;
}

export async function moderateContent(input: ModerationInput): Promise<ModerationDecision> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(input),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }
  return JSON.parse(text) as ModerationDecision;
}
