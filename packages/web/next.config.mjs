/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@sbc/shared", "@sbc/db"],
  serverExternalPackages: ["@prisma/client"],
};
