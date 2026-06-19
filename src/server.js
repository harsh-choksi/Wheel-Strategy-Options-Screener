const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DEFAULT_HOST, DEFAULT_PORT, IS_PRODUCTION, SCREENERS } = require("./config");
const {
  analyzeScreener,
  buildCoveredCallForecastResult,
  buildForecastResult,
  callOptionRequestsForRows,
  finalizeCoveredCallResult,
  finalizeAnalyzedResult,
  getScreenerById,
  optionRequestsForRows,
  reallocateAnalyzedResult
} = require("./lib/analyze");
const { sendJson } = require("./lib/httpUtils");
const { createRateLimiter } = require("./lib/rateLimit");
const { buildZipFromDirectory } = require("./lib/zip");
const packageMetadata = require("../package.json");
const helperManifest = require("../extension/manifest.json");

const PUBLIC_DIR = path.join(__dirname, "public");
const EXTENSION_DIR = path.resolve(__dirname, "..", "extension");
const APP_VERSION = packageMetadata.version || "0.0.0";
const HELPER_VERSION = helperManifest.version || "0.0.0";
const STARTED_AT = new Date().toISOString();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function publicVersionPayload() {
  return {
    app: "wheel-strategy-screener",
    appVersion: APP_VERSION,
    helperVersion: HELPER_VERSION,
    deployedAt: process.env.DEPLOYED_AT || process.env.RELEASE_DEPLOYED_AT || "local",
    nodeEnv: process.env.NODE_ENV || "development"
  };
}

function healthPayload() {
  return {
    ok: true,
    ...publicVersionPayload(),
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: STARTED_AT,
    timestamp: new Date().toISOString()
  };
}

function sendStatic(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

async function sendExtensionZip(res) {
  try {
    const archive = await buildZipFromDirectory(EXTENSION_DIR);
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="wheel-screener-helper.zip"',
      "cache-control": "no-store",
      "content-length": archive.length
    });
    res.end(archive);
  } catch {
    res.writeHead(404);
    res.end("Extension helper package not found");
  }
}

async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5_000_000) {
      throw new Error("Request body is too large.");
    }
  }

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function normalizeExplicitSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    return null;
  }

  return symbols
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean);
}

function cleanContactText(value, maxLength) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!Number.isFinite(maxLength)) {
    return cleaned;
  }

  return cleaned.slice(0, maxLength);
}

function cleanContactEmail(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 254);
}

function cleanContactMessage(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function contactValidationError(body) {
  if (cleanContactText(body.website, 200)) {
    return "Message could not be accepted.";
  }

  const name = cleanContactText(body.name);
  const email = cleanContactEmail(body.email);
  const subject = cleanContactText(body.subject);
  const message = cleanContactMessage(body.message);

  if (!name) {
    return "Name is required.";
  }

  if (!isValidEmail(email)) {
    return "A valid reply email is required.";
  }

  if (!subject) {
    return "Subject is required.";
  }

  if (!message) {
    return "Message is required.";
  }

  return null;
}

function contactSendErrorPayload(error) {
  const code = String(error?.code || "");
  const responseCode = Number.parseInt(error?.responseCode, 10);
  const message = String(error?.message || "");

  if (code === "CONTACT_EMAIL_NOT_CONFIGURED") {
    return {
      status: 503,
      body: {
        code: "CONTACT_EMAIL_NOT_CONFIGURED",
        error: message
      }
    };
  }

  if (code === "CONTACT_EMAIL_AUTH_FAILED" || responseCode === 401 || responseCode === 403) {
    return {
      status: 502,
      body: {
        code: "CONTACT_EMAIL_AUTH_FAILED",
        error: "Resend rejected the API key. Check RESEND_API_KEY, restart the server, and try again."
      }
    };
  }

  if (code === "CONTACT_EMAIL_CONNECTION_FAILED") {
    return {
      status: 502,
      body: {
        code: "CONTACT_EMAIL_CONNECTION_FAILED",
        error: "The server could not reach Resend over HTTPS. Check VPS network/DNS access and server logs."
      }
    };
  }

  if (code === "CONTACT_EMAIL_SEND_FAILED") {
    return {
      status: 502,
      body: {
        code: "CONTACT_EMAIL_SEND_FAILED",
        error:
          "Resend could not send the message. Confirm CONTACT_FROM_EMAIL is a verified sender/domain and check server logs."
      }
    };
  }

  return {
    status: 500,
    body: {
      code: "CONTACT_EMAIL_SEND_FAILED",
      error: "Message could not be sent. Check the server contact email logs."
    }
  };
}

function contactPayload(body) {
  return {
    name: cleanContactText(body.name),
    email: cleanContactEmail(body.email),
    subject: cleanContactText(body.subject),
    message: cleanContactMessage(body.message)
  };
}

function contactToEmail() {
  return process.env.CONTACT_TO_EMAIL;
}

function contactEmailText(payload) {
  return [
    "New Wheel Strategy Screener contact form message",
    "",
    `Name: ${payload.name}`,
    `Reply email: ${payload.email}`,
    `Subject: ${payload.subject}`,
    "",
    payload.message
  ].join("\n");
}

async function defaultContactMailer(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  const to = contactToEmail();

  if (!apiKey || !from || !to) {
    const error = new Error(
      "Contact email is not configured. Set CONTACT_TO_EMAIL, CONTACT_FROM_EMAIL, and RESEND_API_KEY."
    );
    error.code = "CONTACT_EMAIL_NOT_CONFIGURED";
    throw error;
  }

  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: payload.email,
        subject: `[Wheel Strategy Screener] ${payload.subject}`,
        text: contactEmailText(payload)
      })
    });
  } catch (cause) {
    const error = new Error("Resend request failed.");
    error.code = "CONTACT_EMAIL_CONNECTION_FAILED";
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    const error = new Error(`Resend returned HTTP ${response.status}.`);
    error.code =
      response.status === 401 || response.status === 403
        ? "CONTACT_EMAIL_AUTH_FAILED"
        : "CONTACT_EMAIL_SEND_FAILED";
    error.responseCode = response.status;
    error.responseBody = responseBody.slice(0, 500);
    throw error;
  }
}

function parseMinCspReturnDecimal(body) {
  const explicitDecimal = Number.parseFloat(body?.minCspReturnDecimal);
  if (Number.isFinite(explicitDecimal) && explicitDecimal >= 0) {
    return explicitDecimal;
  }

  const explicitPercent = Number.parseFloat(body?.minCspReturnPercent);
  if (Number.isFinite(explicitPercent) && explicitPercent >= 0) {
    return explicitPercent / 100;
  }

  return undefined;
}

function createAppServer({ forecastFetcher, currentPriceFetcher, contactMailer } = {}) {
  const runLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12 });
  const contactLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

  async function handleApi(req, res) {
    const requestUrl = new URL(req.url, "http://localhost");

    if (req.method === "GET" && requestUrl.pathname === "/api/version") {
      sendJson(res, 200, publicVersionPayload());
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/screeners") {
      sendJson(res, 200, {
        screeners: SCREENERS,
        defaultScreenerId: "safe",
        production: IS_PRODUCTION,
        liveSource: "chrome-extension"
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/run") {
      const limit = runLimiter(clientIp(req));
      if (!limit.allowed) {
        sendJson(res, 429, {
          error: "Too many scans. Try again shortly."
        });
        return;
      }

      const body = await readJsonBody(req);
      const portfolioValue = Number.parseFloat(body.portfolioValue);
      const minCspReturnDecimal = parseMinCspReturnDecimal(body);
      const mode = body.mode === "live" ? "live" : "mock";
      const explicitSymbols = normalizeExplicitSymbols(body.symbols);
      let symbols;
      let source = body.source || (mode === "live" ? "robinhood" : "mock");

      if (explicitSymbols) {
        symbols = explicitSymbols;
        if (symbols.length === 0) {
          sendJson(res, 422, {
            error: "Add at least one stock symbol before scanning."
          });
          return;
        }
      } else if (mode === "live") {
        const screener = getScreenerById(body.screenerId);
        sendJson(res, 422, {
          error: `No stock symbols were found in "${body.screenerName || screener.name}".`
        });
        return;
      }

      const result = await analyzeScreener({
        screenerId: body.screenerId,
        screenerName: body.screenerName,
        mode,
        portfolioValue,
        symbols,
        source,
        forecastFetcher,
        refreshMarketData: true,
        optionQuotesBySymbol: body.optionQuotesBySymbol,
        optionDiagnosticsBySymbol: body.optionDiagnosticsBySymbol,
        minCspReturnDecimal
      });

      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/forecast") {
      const limit = runLimiter(clientIp(req));
      if (!limit.allowed) {
        sendJson(res, 429, {
          error: "Too many scans. Try again shortly."
        });
        return;
      }

      const body = await readJsonBody(req);
      const portfolioValue = Number.parseFloat(body.portfolioValue);
      const mode = body.mode === "live" ? "live" : "mock";
      const explicitSymbols = normalizeExplicitSymbols(body.symbols);
      let symbols;
      let source = body.source || (mode === "live" ? "robinhood" : "mock");

      if (explicitSymbols) {
        symbols = explicitSymbols;
        if (symbols.length === 0) {
          sendJson(res, 422, {
            error: "Add at least one stock symbol before scanning."
          });
          return;
        }
      } else if (mode === "live") {
        const screener = getScreenerById(body.screenerId);
        sendJson(res, 422, {
          error: `No stock symbols were found in "${body.screenerName || screener.name}".`
        });
        return;
      }

      const result = await buildForecastResult({
        screenerId: body.screenerId,
        screenerName: body.screenerName,
        mode,
        portfolioValue,
        symbols,
        source,
        forecastFetcher,
        refreshMarketData: true
      });

      sendJson(res, 200, {
        ...result,
        optionRequests: optionRequestsForRows(result.rows)
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/finalize") {
      const body = await readJsonBody(req);
      const portfolioValue = Number.parseFloat(body.portfolioValue);
      const minCspReturnDecimal = parseMinCspReturnDecimal(body);
      const optionQuotesBySymbol =
        body.optionQuotesBySymbol && typeof body.optionQuotesBySymbol === "object"
          ? body.optionQuotesBySymbol
          : undefined;
      const result = finalizeAnalyzedResult(
        body.result,
        portfolioValue,
        optionQuotesBySymbol,
        body.optionDiagnosticsBySymbol || {},
        minCspReturnDecimal
      );

      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/covered-calls/forecast") {
      const limit = runLimiter(clientIp(req));
      if (!limit.allowed) {
        sendJson(res, 429, {
          error: "Too many scans. Try again shortly."
        });
        return;
      }

      const body = await readJsonBody(req);
      const mode = body.mode === "live" ? "live" : "mock";
      const positions = Array.isArray(body.positions) ? body.positions : [];
      const hasCoveredCallSymbol = positions.some((position) =>
        String(position?.symbol || "").trim()
      );

      if (!hasCoveredCallSymbol) {
        sendJson(res, 422, {
          error: "Add at least one covered-call position before scanning."
        });
        return;
      }

      const result = await buildCoveredCallForecastResult({
        positions,
        mode,
        source: body.source || (mode === "live" ? "robinhood" : "mock"),
        forecastFetcher,
        currentPriceFetcher,
        refreshMarketData: true
      });

      sendJson(res, 200, {
        ...result,
        optionRequests: callOptionRequestsForRows(result.rows)
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/covered-calls/finalize") {
      const body = await readJsonBody(req);
      const minCspReturnDecimal = parseMinCspReturnDecimal(body);
      const optionQuotesBySymbol =
        body.optionQuotesBySymbol && typeof body.optionQuotesBySymbol === "object"
          ? body.optionQuotesBySymbol
          : undefined;
      const result = finalizeCoveredCallResult(
        body.result,
        optionQuotesBySymbol,
        body.optionDiagnosticsBySymbol || {},
        minCspReturnDecimal
      );

      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/reallocate") {
      const body = await readJsonBody(req);
      const portfolioValue = Number.parseFloat(body.portfolioValue);
      const result = reallocateAnalyzedResult(body.result, portfolioValue);

      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/contact") {
      const limit = contactLimiter(clientIp(req));
      if (!limit.allowed) {
        sendJson(res, 429, {
          error: "Too many contact attempts. Try again later."
        });
        return;
      }

      const body = await readJsonBody(req);
      const validationError = contactValidationError(body);
      if (validationError) {
        sendJson(res, 400, {
          error: validationError
        });
        return;
      }

      try {
        await (contactMailer || defaultContactMailer)(contactPayload(body));
        sendJson(res, 200, {
          ok: true
        });
      } catch (error) {
        console.error("Contact email send failed", {
          code: error.code,
          command: error.command,
          responseCode: error.responseCode,
          message: error.message,
          responseBody: error.responseBody,
          causeCode: error.cause?.code,
          causeMessage: error.cause?.message
        });
        const failure = contactSendErrorPayload(error);
        sendJson(res, failure.status, failure.body);
      }
      return;
    }

    sendJson(res, 404, {
      error: "Unknown API route."
    });
  }

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/healthz") {
      sendJson(res, 200, healthPayload());
      return;
    }

    if (req.url.startsWith("/api/")) {
      handleApi(req, res).catch((error) => {
        sendJson(res, 500, {
          error: error.message
        });
      });
      return;
    }

    if (
      req.method === "GET" &&
      new URL(req.url, "http://localhost").pathname === "/downloads/wheel-screener-helper.zip"
    ) {
      sendExtensionZip(res).catch((error) => {
        sendJson(res, 500, {
          error: error.message
        });
      });
      return;
    }

    sendStatic(req, res);
  });

  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : DEFAULT_PORT;
    const displayHost = DEFAULT_HOST === "0.0.0.0" ? "localhost" : DEFAULT_HOST;
    console.log(`Wheel Strategy Screener running at http://${displayHost}:${boundPort}`);
  });
}

module.exports = {
  createAppServer
};
