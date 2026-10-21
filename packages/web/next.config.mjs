/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@falkon/shared", "@falkon/db"],
  serverExternalPackages: ["@prisma/client", "@grpc/grpc-js", "@grpc/proto-loader"],
};
