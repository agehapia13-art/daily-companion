import {
  apiCompleteAction,
  apiDismissCardToday,
  apiFlushOutboxBatch,
  apiGetHomeBootstrap,
  apiImportFromSheets,
  apiMutateListItem,
  apiRefreshDeck,
  apiStartAction,
  handleInternalExportDay,
  handleInternalSyncMemory
} from './api-core';
import { handleChatStream } from './chat';
import { Env } from './types';
import { corsHeaders, jsonResponse } from './utils';

type ApiHandler = (env: Env, ctx: ExecutionContext, ...args: any[]) => Promise<unknown>;

const API_HANDLERS: Record<string, ApiHandler> = {
  apiGetHomeBootstrap,
  apiStartAction,
  apiCompleteAction,
  apiDismissCardToday,
  apiMutateListItem,
  apiFlushOutboxBatch,
  apiRefreshDeck,
  apiImportFromSheets
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/ping') {
      return new Response('OK (Companion Cockpit Workers Active)', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...corsHeaders()
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/internal/export-day') {
      return handleInternalExportDay(env, request);
    }

    if (request.method === 'POST' && url.pathname === '/internal/sync-memory') {
      return handleInternalSyncMemory(env, request);
    }

    if (request.method === 'POST' && url.pathname === '/chat/stream') {
      try {
        const rawText = await request.text();
        if (!rawText) {
          return jsonResponse({ ok: false, error: 'Empty request body' }, 400);
        }
        const payload = JSON.parse(rawText) as {
          authKey?: string;
          messagePayload?: unknown;
          payload?: unknown;
          args?: unknown[];
          text?: string;
          imageBase64?: string;
          imageMimeType?: string;
        };
        const authKey = String(
          payload?.authKey ?? (Array.isArray(payload?.args) ? payload.args[0] : '') ?? ''
        );
        const messagePayload =
          payload?.messagePayload !== undefined
            ? payload.messagePayload
            : payload?.payload !== undefined
              ? payload.payload
              : Array.isArray(payload?.args) && payload.args.length > 1
                ? payload.args[1]
                : payload;

        return handleChatStream(env, ctx, authKey, messagePayload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ ok: false, error: msg }, 400);
      }
    }

    if (request.method === 'POST' && url.pathname === '/') {
      try {
        const rawText = await request.text();
        if (!rawText) {
          return jsonResponse({ ok: false, error: 'Empty request body' }, 400);
        }

        const payload = JSON.parse(rawText) as {
          apiAction?: string;
          args?: unknown[];
        };

        const action = String(payload?.apiAction || '').trim();
        const args = Array.isArray(payload?.args) ? payload.args : [];

        const handler = API_HANDLERS[action];
        if (!handler) {
          return jsonResponse({ ok: false, error: `Unknown apiAction: ${action}` }, 400);
        }

        const data = await handler(env, ctx, ...args);
        return jsonResponse({ ok: true, data });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ ok: false, error: msg }, 500);
      }
    }

    return jsonResponse({ ok: false, error: 'Not Found' }, 404);
  }
};
