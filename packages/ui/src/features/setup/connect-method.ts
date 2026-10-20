import type { Provider } from "@sbc/contracts";

export type Method = "token" | "app";
type Fields = {
  token: string;
  appId: string;
  privateKey: string;
  installationId: string;
};

/** True when the connect step has everything its method needs. */
export const connectReady = (method: Method, f: Fields) =>
  method === "token"
    ? !!f.token
    : !!(f.appId && f.privateKey && f.installationId);

/** The POST /api/connections body: only the chosen method's fields. */
export const connectRequest = (
  method: Method,
  f: Fields & { provider: Provider; host: string },
) =>
  method === "token"
    ? { provider: f.provider, host: f.host, method, token: f.token }
    : {
        provider: f.provider,
        host: f.host,
        method,
        appId: f.appId,
        privateKey: f.privateKey,
        installationId: f.installationId,
      };
