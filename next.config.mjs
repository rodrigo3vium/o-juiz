import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Há um package-lock.json no diretório home; fixa a raiz neste projeto.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
