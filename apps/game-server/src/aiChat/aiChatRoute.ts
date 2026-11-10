/**
 * Express router for `POST /api/ai-chat`, mounted on the same HTTP origin as
 * the Colyseus game server (via `Server.attachExpressApp`).
 *
 * The web client already resolves the game-server origin from
 * `VITE_GAME_SERVER_URL` (default `ws://localhost:2567`); the chat endpoint
 * lives at `http(s)://<same host:port>/api/ai-chat`, so no new cross-origin
 * configuration is needed on the client. To keep the browser dev-server
 * origin (e.g. Vite on :5173) working as before, the route answers CORS
 * preflights and echoes the request `Origin` — the same permissive
 * cross-origin posture the Colyseus handshake already has.
 *
 * Every response — success or error — is a small, bounded JSON payload.
 * Errors never contain secrets, request payloads, or raw upstream/internal
 * error text.
 */
import express, { Router, type NextFunction, type Request, type Response } from "express";

import type { ChatErrorDetails, ChatService } from "./chatService.js";
import { AI_CHAT } from "./limits.js";

const CORS_ORIGIN_MAX_LENGTH = 2048;

/** Bounded JSON error payload shape (never contains raw error text). */
interface JsonErrorDetails {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
}

/** Apply the bounded cross-origin headers when the request carries an Origin. */
function applyCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0 || origin.length > CORS_ORIGIN_MAX_LENGTH) {
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}

function jsonError(res: Response, statusCode: number, details: JsonErrorDetails): void {
  res.status(statusCode).json({
    error: { code: details.code, message: details.message },
  });
}

/**
 * Create the chat router.
 *
 * @param service validated-and-audited chat handler (see `chatService.ts`)
 */
export function createAiChatRouter(service: ChatService): Router {
  const router = Router();

  // CORS preflight for the chat route only.
  router.options(AI_CHAT.route, (req: Request, res: Response) => {
    applyCorsHeaders(req, res);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });

  router.post(
    AI_CHAT.route,
    express.json({ limit: AI_CHAT.jsonBodyLimit, type: "application/json" }),
    async (req: Request, res: Response) => {
      applyCorsHeaders(req, res);
      try {
        const result = await service(req.body);
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof Error && "code" in error) {
          const candidate = error as unknown as ChatErrorDetails;
          if (
            typeof candidate.code === "string" &&
            typeof candidate.statusCode === "number" &&
            candidate.statusCode >= 400 &&
            candidate.statusCode < 600 &&
            typeof candidate.message === "string"
          ) {
            jsonError(res, candidate.statusCode, candidate);
            return;
          }
        }
        jsonError(
          res,
          500,
          {
            code: "internal_error",
            message: "Something went wrong on the server. Please try again.",
            statusCode: 500,
          },
        );
      }
    },
  );

  // Malformed JSON / oversized body from `express.json` arrive here.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const maybeStatus = (error as { status?: unknown } | null)?.status;
    const statusCode =
      typeof maybeStatus === "number" ? maybeStatus : 400;
    if (statusCode === 413) {
      jsonError(res, 413, {
        code: "message_too_long",
        message: `Request body is too large (maximum ${AI_CHAT.jsonBodyLimit}).`,
        statusCode: 413,
      });
      return;
    }
    jsonError(res, 400, {
      code: "invalid_request",
      message: "Request body must be valid JSON with a \"message\" string.",
      statusCode: 400,
    });
  });

  return router;
}
