// User preferences, kept in the webview's local storage. API keys are not
// here: they live in the OS keychain under each profile's id.
import { ipc } from "./ipc";

export type ApiFormat = "openai" | "anthropic";

export interface AiProfile {
  id: string;
  name: string;
  format: ApiFormat;
  baseUrl: string;
  model: string;
}

export const PROFILE_PRESETS: { label: string; profile: Omit<AiProfile, "id"> }[] = [
  { label: "Anthropic (Claude)", profile: { name: "Claude", format: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" } },
  { label: "OpenAI", profile: { name: "OpenAI", format: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5" } },
  { label: "OpenRouter", profile: { name: "OpenRouter", format: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" } },
  { label: "Google Gemini", profile: { name: "Gemini", format: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro" } },
  { label: "xAI (Grok)", profile: { name: "xAI", format: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-4" } },
  { label: "Groq", profile: { name: "Groq", format: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" } },
  { label: "Ollama (local)", profile: { name: "Ollama", format: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.1" } },
];

export interface Signature {
  id: string;
  /** PNG data URL with a transparent background. */
  src: string;
  width: number;
  height: number;
}

/** auto: download in the background and install on quit; notify: ask first; off: only on request. */
export type UpdateMode = "auto" | "notify" | "off";

interface Stored {
  profiles: AiProfile[];
  activeProfileId: string;
  recent: string[];
  signatures: Signature[];
  mcpEnabled: boolean;
  /** The agent the MCP setup steps are shown for. */
  mcpClient: string;
  showSidebar: boolean;
  showChat: boolean;
  /** Color per tool, remembered between sessions. */
  colors: Record<string, string>;
  /** Installed font family for new text boxes; "" = the default. */
  textFont: string;
  updateMode: UpdateMode;
  /** KlikPaper's actions in the Explorer right-click menu (Windows) or Finder Quick Actions (macOS). */
  shellMenu: boolean;
  /** The version that last ran, to show what's new once after an update. */
  lastVersion: string;
  /** How Home shows recent files. */
  recentView: "tiles" | "list";
}

const KEY = "klikpaper.settings";

/** Whether settings were already saved before this launch (the app has been used), read once at startup. */
export let hadSettings = false;

function load(): Stored {
  const fallback: Stored = {
    profiles: [],
    activeProfileId: "",
    recent: [],
    signatures: [],
    mcpEnabled: false,
    mcpClient: "claude",
    showSidebar: true,
    showChat: false,
    colors: {},
    textFont: "",
    updateMode: "auto",
    shellMenu: false,
    lastVersion: "",
    recentView: "tiles",
  };
  try {
    const raw = localStorage.getItem(KEY);
    hadSettings = !!raw;
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {}
  return fallback;
}

export const settings = $state<Stored>(load());

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function newId(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function addRecent(path: string) {
  settings.recent = [path, ...settings.recent.filter((p) => p !== path)].slice(0, 12);
  persist();
}

export function removeRecent(path: string) {
  settings.recent = settings.recent.filter((p) => p !== path);
  persist();
}

export function activeProfile(): AiProfile | undefined {
  return settings.profiles.find((p) => p.id === settings.activeProfileId) ?? settings.profiles[0];
}

export function addProfile(p: Omit<AiProfile, "id">): string {
  const id = newId("p");
  settings.profiles.push({ ...p, id });
  if (!settings.activeProfileId) settings.activeProfileId = id;
  persist();
  return id;
}

export function removeProfile(id: string) {
  settings.profiles = settings.profiles.filter((p) => p.id !== id);
  if (settings.activeProfileId === id) settings.activeProfileId = settings.profiles[0]?.id ?? "";
  persist();
  ipc.deleteKey(id).catch(() => {});
}
