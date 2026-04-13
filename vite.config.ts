import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// Expose LLM_* (e.g. Cloudflare Pages / Poe) to the client bundle the same way as VITE_*.
const llmFromProcess = {
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? "",
  LLM_MODEL: process.env.LLM_MODEL ?? "",
};

export default defineConfig(() => ({
  define: {
    "import.meta.env.LLM_API_KEY": JSON.stringify(llmFromProcess.LLM_API_KEY),
    "import.meta.env.LLM_BASE_URL": JSON.stringify(llmFromProcess.LLM_BASE_URL),
    "import.meta.env.LLM_MODEL": JSON.stringify(llmFromProcess.LLM_MODEL),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
