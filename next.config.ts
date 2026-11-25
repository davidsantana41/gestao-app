import type { NextConfig } from "next";

const homologacao = process.env.VERCEL_ENV === "preview"
  || process.env.VERCEL_GIT_COMMIT_REF === "homologacao/appcar"
  || process.env.APPCAR_HOMOLOGACAO === "1";

if (homologacao && (!process.env.NEXT_PUBLIC_APPCAR_HML_API_KEY?.trim()
    || !process.env.NEXT_PUBLIC_APPCAR_HML_APP_ID?.trim())) {
  throw new Error("Configure o Firebase de homologação antes de publicar o Preview do APPCAR.");
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APPCAR_HOMOLOGACAO: homologacao ? "1" : "0" },
  /* config options here */
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  // Evita reutilizar trechos do formulário enquanto os valores estão sendo editados.
  reactCompiler: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
