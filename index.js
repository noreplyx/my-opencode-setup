import {
  OpenAICompatibleProvider,
  consoleReporter,
  evaluateSkills,
  loadConfigFile
} from "agent-skills-eval";
import { configDotenv } from "dotenv";

configDotenv();
const provider = new OpenAICompatibleProvider({
  baseUrl: "https://ollama.com/v1",
  apiKey: process.env.OPENAI_API_KEY,
  model: "deepseek-v4-flash",
  providerName: "ollama-cloud",
});

const result = await evaluateSkills({
  root: "./skills",
  workspace: "./agent-skills-workspace",
  baseline: true,
  workspaceLayout: "iteration",
  strict: true,
  concurrency: 4,
  target: { model: provider.model, provider },
  judge: { model: provider.model, provider },
  onEvent: consoleReporter(),
});