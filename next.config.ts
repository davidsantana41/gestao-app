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
  // Keep the Admin Auth dependency chain in Node's package resolver. Turbopack
  // otherwise resolves jwks-rsa's jose import to the unrelated ESM-only copy
  // used by Firebase tooling, which crashes the production route at startup.
  serverExternalPackages: ["firebase-admin", "jwks-rsa"],
  /* config options here */
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  // Evita reutilizar trechos do formulário enquanto os valores estão sendo editados.
  reactCompiler: false,
  turbopack: {
    // Keep package resolution inside this repository when a parent directory
    // happens to contain another lockfile.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
