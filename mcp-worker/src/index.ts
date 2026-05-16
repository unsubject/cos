import postgres from 'postgres';
import type { Env } from './env';
import { handleMcpRequest } from './mcp';

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    if (request.method === 'GET' && url.pathname === '/db-health') {
      const sql = postgres(env.HYPERDRIVE.connectionString, { max: 1, fetch_types: false });
      try {
        const rows = await sql<{ version: string }[]>`SELECT version()`;
        return Response.json({ ok: true, version: rows[0]?.version ?? null });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      } finally {
        ctx.waitUntil(sql.end({ timeout: 5 }));
      }
    }

    if (url.pathname === '/mcp') {
      return handleMcpRequest(request, env, ctx);
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
