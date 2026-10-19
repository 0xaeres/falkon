import { Controller, Delete, Get, Inject, Module, NotFoundException, Param, Post, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scopeFor, type Scope } from "@sbc/shared";
import { isProductName, PRODUCT_RESOLVER, type ProductResolver } from "./product";
import { sendWebResponse, toWebRequest } from "./webAdapter";

/** The existing MCP runners (`handleMcpPost`, `handleMcpDelete` in the web package), injected so tests can fake them. */
export interface McpHandlers {
  post(req: Request, scope: Scope): Promise<Response>;
  delete(req: Request, scope: Scope): Promise<Response>;
}
export const MCP_HANDLERS = Symbol("McpHandlers");

@Controller("mcp")
class McpController {
  // Explicit @Inject: tsx does not emit decorator metadata.
  constructor(
    @Inject(PRODUCT_RESOLVER) private readonly products: ProductResolver,
    @Inject(MCP_HANDLERS) private readonly mcp: McpHandlers,
  ) {}

  @Post(":product")
  post(@Param("product") product: string, @Req() req: IncomingMessage, @Res() res: ServerResponse) {
    return this.serve(product, req, res, this.mcp.post);
  }

  @Delete(":product")
  delete(@Param("product") product: string, @Req() req: IncomingMessage, @Res() res: ServerResponse) {
    return this.serve(product, req, res, this.mcp.delete);
  }

  @Get(":product")
  get(@Res() res: ServerResponse) {
    res.writeHead(405, { Allow: "POST, DELETE" }).end();
  }

  private async serve(product: string, req: IncomingMessage, res: ServerResponse, handle: McpHandlers["post"]) {
    const repos = isProductName(product) ? await this.products.repoNames(product) : undefined;
    if (!repos) throw new NotFoundException({ statusCode: 404, errorCode: "NOT_FOUND", message: "Product not found." });
    // No authentication yet (auth mode none): everyone is "anonymous" and gets the Product's full set.
    // The MCP session map lives in mcp.ts, keyed by session id and owner only. Binding a session to the
    // Product it was opened under (and to the set at creation) is S4's job (P11); it is not done here.
    const scope: Scope = { ...scopeFor(repos), principal: "anonymous" };
    await sendWebResponse(res, await handle(await toWebRequest(req), scope));
  }
}

export async function createApp(resolver: ProductResolver, mcp: McpHandlers) {
  @Module({
    controllers: [McpController],
    providers: [{ provide: PRODUCT_RESOLVER, useValue: resolver }, { provide: MCP_HANDLERS, useValue: mcp }],
  })
  class AppModule {}
  // The MCP transport reads the raw request itself.
  return NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn"] });
}
