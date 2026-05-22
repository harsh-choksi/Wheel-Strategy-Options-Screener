const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DEFAULT_PORT, IS_PRODUCTION, SCREENERS } = require("./config");
const { analyzeScreener, getScreenerById } = require("./lib/analyze");
const { sendJson } = require("./lib/httpUtils");
const { createRateLimiter } = require("./lib/rateLimit");
const { buildZipFromDirectory } = require("./lib/zip");

const PUBLIC_DIR = path.join(__dirname, "public");
const EXTENSION_DIR = path.resolve(__dirname, "..", "extension");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

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
    if (body.length > 1_000_000) {
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

function sessionPayload() {
  return {
    user: null,
    helperWorkflow: true,
    remoteRobinhood: {
      enabled: false,
      hasSession: false,
      status: "extension_required",
      ready: false,
      liveUrl: null
    }
  };
}

function normalizeExplicitSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    return null;
  }

  return symbols
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean);
}

function createAppServer({ forecastFetcher } = {}) {
  const runLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12 });

  async function handleApi(req, res) {
    const requestUrl = new URL(req.url, "http://localhost");

    if (req.method === "GET" && requestUrl.pathname === "/api/screeners") {
      sendJson(res, 200, {
        screeners: SCREENERS,
        defaultScreenerId: "safe",
        production: IS_PRODUCTION,
        liveSource: "chrome-extension"
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/session") {
      sendJson(res, 200, sessionPayload());
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
      const mode = body.mode === "live" ? "live" : "mock";
      const explicitSymbols = normalizeExplicitSymbols(body.symbols);
      let symbols;
      let source;

      if (mode === "live") {
        const screener = getScreenerById(body.screenerId);

        if (!explicitSymbols) {
          sendJson(res, 422, {
            error: "Robinhood source requires the Chrome helper."
          });
          return;
        }

        symbols = explicitSymbols;
        source = "robinhood";

        if (symbols.length === 0) {
          sendJson(res, 422, {
            error: `No stock symbols were found in "${screener.name}".`
          });
          return;
        }
      }

      const result = await analyzeScreener({
        screenerId: body.screenerId,
        mode,
        portfolioValue,
        symbols,
        source,
        forecastFetcher
      });

      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, {
      error: "Unknown API route."
    });
  }

  const server = http.createServer((req, res) => {
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
  server.listen(DEFAULT_PORT, () => {
    console.log(`Wheel Strategy Options Screener running at http://localhost:${DEFAULT_PORT}`);
  });
}

module.exports = {
  createAppServer
};
