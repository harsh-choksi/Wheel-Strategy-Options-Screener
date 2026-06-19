(() => {
  if (window.__wheelScreenerRobinhoodHelper) {
    return;
  }

  window.__wheelScreenerRobinhoodHelper = true;

  const IGNORED_WORDS = new Set([
    "BUY",
    "SELL",
    "CASH",
    "USD",
    "ETF",
    "ETFS",
    "APY",
    "CEO",
    "IRA",
    "IPO",
    "FAQ"
  ]);

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function visible(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function normalizeSymbol(symbol) {
    const normalized = String(symbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z.-]/g, "");

    if (
      normalized.length >= 1 &&
      normalized.length <= 7 &&
      /^[A-Z][A-Z.-]*$/.test(normalized) &&
      !IGNORED_WORDS.has(normalized)
    ) {
      return normalized;
    }

    return null;
  }

  function isLoggedIn() {
    if (/\/login\b|\/signup\b/i.test(window.location.pathname)) {
      return false;
    }

    const visibleLoginText = [...document.querySelectorAll("a, button")]
      .filter(visible)
      .some((element) => element.textContent?.trim().toLowerCase() === "log in");

    return !visibleLoginText;
  }

  async function waitForRobinhoodApp() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (document.body && normalizeText(document.body.innerText).length > 80) {
        return;
      }
      await wait(250);
    }
  }

  function clickableAncestor(element) {
    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1) {
      const tag = current.tagName?.toLowerCase();
      const role = current.getAttribute?.("role");
      const style = window.getComputedStyle(current);

      if (
        tag === "a" ||
        tag === "button" ||
        role === "button" ||
        role === "link" ||
        current.tabIndex >= 0 ||
        style.cursor === "pointer"
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return element;
  }

  function listRowAncestor(element, targetText) {
    let current = element;
    let best = element;

    for (let depth = 0; current && depth < 9; depth += 1) {
      if (!visible(current)) {
        current = current.parentElement;
        continue;
      }

      const rect = current.getBoundingClientRect();
      const label = elementLabel(current);
      const exactText = label === targetText;
      const rowSized =
        rect.width >= 180 &&
        rect.height >= 28 &&
        rect.height <= 110;

      if (exactText && rowSized) {
        best = current;
      }

      current = current.parentElement;
    }

    return best;
  }

  function elementLabel(element) {
    return normalizeText(
      element.getAttribute?.("aria-label") ||
        element.getAttribute?.("title") ||
        element.textContent ||
        ""
    );
  }

  function isListTextMatch(text, targetText) {
    const normalized = normalizeText(text);
    if (normalized === targetText) {
      return true;
    }

    return (
      normalized.includes(targetText) &&
      normalized.length <= targetText.length + 30
    );
  }

  function candidateElementsForText(targetText) {
    const candidates = [];
    const seen = new Set();

    for (const { element, label } of [...document.querySelectorAll("a, button, [role='button'], [role='link'], span, div")]
      .map((element) => ({
        element,
        label: elementLabel(element)
      }))
      .filter(({ element, label }) => label && isListTextMatch(label, targetText) && visible(element))
      .sort((a, b) => {
        const aExact = a.label === targetText ? 0 : 1;
        const bExact = b.label === targetText ? 0 : 1;
        return aExact - bExact || a.label.length - b.label.length;
      })) {
      const targets = [
        listRowAncestor(element, targetText),
        clickableAncestor(element),
        element
      ];

      for (const target of targets) {
        if (!target || seen.has(target) || !visible(target)) {
          continue;
        }
        seen.add(target);
        candidates.push(target);
      }
    }

    return candidates.sort((a, b) => candidateClickScore(a, targetText) - candidateClickScore(b, targetText));
  }

  function candidateClickScore(element, targetText) {
    const rect = element.getBoundingClientRect();
    const label = elementLabel(element);
    const exact = label === targetText ? 0 : 20;
    const rowLike = rect.width >= 180 && rect.height >= 28 && rect.height <= 110 ? 0 : 10;
    const interactive =
      element.matches?.("a, button, [role='button'], [role='link']") ||
      element.tabIndex >= 0 ||
      window.getComputedStyle(element).cursor === "pointer"
        ? 0
        : 4;
    return exact + rowLike + interactive + Math.min(label.length / 1000, 2);
  }

  function clickLikeUser(element) {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const pointTarget = document.elementFromPoint(clientX, clientY);
    const targets =
      pointTarget && (pointTarget === element || element.contains?.(pointTarget))
        ? [element]
        : [...new Set([pointTarget, element].filter(Boolean))];

    for (const target of targets) {
      for (const type of ["pointerover", "mouseover", "pointermove", "mousemove"]) {
        const isPointer = type.startsWith("pointer") && typeof PointerEvent === "function";
        const EventConstructor = isPointer ? PointerEvent : MouseEvent;
        target.dispatchEvent(
          new EventConstructor(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            button: 0,
            buttons: type.includes("down") ? 1 : 0,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true
          })
        );
      }

      if (typeof target.click === "function") {
        target.click();
      } else {
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY
          })
        );
      }
    }
  }

  function symbolSignature(symbols) {
    return [...symbols].sort().join("|");
  }

  async function waitForClickEffect(beforeUrl, beforeSignature) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(250);
      const currentSignature = symbolSignature(extractSymbolsFromPage());
      if (window.location.href !== beforeUrl) {
        return true;
      }
      if (currentSignature && currentSignature !== beforeSignature) {
        return true;
      }
    }

    return false;
  }

  function scrollContainers(direction = 1) {
    const scrollables = [
      document.scrollingElement,
      ...document.querySelectorAll("aside, nav, main, section, div, ul, [role='list'], [role='grid'], [role='table']")
    ].filter((element, index, elements) => {
      if (!element || elements.indexOf(element) !== index) {
        return false;
      }

      const canScroll = element.scrollHeight > element.clientHeight + 20;
      return canScroll && visible(element);
    });

    let moved = false;
    for (const element of scrollables) {
      const before = element.scrollTop;
      const amount = Math.max(Math.round(element.clientHeight * 0.7), 320) * direction;
      element.scrollTop = Math.max(0, Math.min(element.scrollTop + amount, element.scrollHeight));
      if (element.scrollTop !== before) {
        moved = true;
      }
    }

    return moved;
  }

  function resetScrollableContainers() {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll("aside, nav, main, section, div, ul, [role='list'], [role='grid'], [role='table']")) {
      if (element.scrollHeight > element.clientHeight + 20) {
        element.scrollTop = 0;
      }
    }
  }

  async function clickPossibleListExpander() {
    const labels = [
      "Lists",
      "Watchlists",
      "Show more",
      "See more",
      "View all",
      "More"
    ];

    for (const label of labels) {
      const candidate = candidateElementsForText(label)[0];
      if (candidate) {
        clickLikeUser(candidate);
        await wait(300);
        return true;
      }
    }

    return false;
  }

  async function clickListByName(listName) {
    await waitForRobinhoodApp();
    resetScrollableContainers();

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidates = candidateElementsForText(listName);
      for (const clickable of candidates) {
        const beforeUrl = window.location.href;
        const beforeSignature = symbolSignature(extractSymbolsFromPage());
        clickLikeUser(clickable);
        const opened = await waitForClickEffect(beforeUrl, beforeSignature);

        if (opened) {
          return true;
        }
      }

      if (attempt % 8 === 2) {
        await clickPossibleListExpander();
      }

      const moved = scrollContainers(attempt % 12 < 10 ? 1 : -1);
      if (!moved && attempt > 12) {
        resetScrollableContainers();
      }

      await wait(150);
    }

    return false;
  }

  function extractSymbolsFromPage(root = document) {
    const found = [];
    const seen = new Set();

    const push = (symbol) => {
      const normalized = normalizeSymbol(symbol);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        found.push(normalized);
      }
    };

    for (const anchor of root.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") || "";
      const match = href.match(/\/(?:stocks|etfs)\/([A-Z. -]{1,8})(?:[/?#]|$)/i);
      if (match) {
        push(match[1]);
      }
    }

    if (found.length === 0) {
      const text = root === document ? document.body?.innerText || "" : root.innerText || "";
      const matches = text.match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g) || [];
      for (const match of matches) {
        push(match);
      }
    }

    return found;
  }

  function stockAnchors(root = document) {
    return [...root.querySelectorAll("a[href]")].filter((anchor) =>
      /\/(?:stocks|etfs)\/([A-Z. -]{1,8})(?:[/?#]|$)/i.test(anchor.getAttribute("href") || "")
    );
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function visibleStockAnchors() {
    return stockAnchors(document).filter(visible);
  }

  function visibleStockAnchorsIn(element) {
    return stockAnchors(element).filter(visible);
  }

  function elementContainsStockLinks(element) {
    return stockAnchors(element).length > 0;
  }

  function scrollableScore(element) {
    if (!element || !visible(element)) {
      return -1;
    }

    const rect = element.getBoundingClientRect();
    const stockCount = elementContainsStockLinks(element) ? stockAnchors(element).length : 0;
    const scrollDistance = Math.max(0, element.scrollHeight - element.clientHeight);
    const area = rect.width * rect.height;
    const usableSize = rect.height > 80 && rect.width > 220 ? 1 : 0;
    const scrollable = scrollDistance > 20 ? 1 : 0;

    return stockCount * 1000 + scrollable * 300 + usableSize * 100 + Math.min(area / 10000, 80);
  }

  function stockListScrollTargets() {
    const targets = [];

    for (const anchor of visibleStockAnchors()) {
      let current = anchor;
      for (let depth = 0; current && depth < 10; depth += 1) {
        targets.push(current);
        current = current.parentElement;
      }
    }

    targets.push(document.scrollingElement, document.documentElement, document.body);

    for (const element of document.querySelectorAll("main, aside, section, div, ul, [role='list'], [role='grid'], [role='table'], [data-testid]")) {
      if (visible(element)) {
        targets.push(element);
      }
    }

    return uniqueElements(targets)
      .filter((element) => element && scrollableScore(element) >= 0)
      .sort((a, b) => scrollableScore(b) - scrollableScore(a))
      .slice(0, 4);
  }

  function lastVisibleStockAnchor() {
    return visibleStockAnchors()
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .at(-1);
  }

  function bestSymbolRoot() {
    const roots = stockListScrollTargets();
    return roots.find((element) => visibleStockAnchorsIn(element).length > 0) || document;
  }

  function dispatchWheelAt(element, deltaY) {
    const rect = element.getBoundingClientRect();
    const clientX = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const clientY = Math.max(1, Math.min(window.innerHeight - 1, rect.top + Math.min(rect.height * 0.75, rect.height - 8)));
    const target = document.elementFromPoint(clientX, clientY) || element;

    target.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY,
        deltaX: 0,
        deltaMode: 0,
        clientX,
        clientY,
        view: window
      })
    );
  }

  function dispatchPageDown(element) {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "PageDown",
        code: "PageDown",
        keyCode: 34,
        which: 34
      })
    );
  }

  async function scrollRobinhoodList() {
    let moved = false;
    const amount = Math.max(Math.round(window.innerHeight * 1.15), 1100);
    const anchor = lastVisibleStockAnchor();

    if (anchor) {
      for (let index = 0; index < 5; index += 1) {
        dispatchWheelAt(anchor, amount);
      }
      dispatchPageDown(anchor);
    }

    const targets = stockListScrollTargets().slice(0, 2);

    for (const element of targets) {
      const before = element.scrollTop;
      const targetAmount = Math.max(Math.round((element.clientHeight || window.innerHeight) * 1.2), 1200);

      if (typeof element.scrollBy === "function") {
        element.scrollBy({ top: targetAmount * 3, left: 0, behavior: "auto" });
      }

      element.scrollTop = Math.min(element.scrollTop + targetAmount * 3, element.scrollHeight);
      for (let index = 0; index < 3; index += 1) {
        dispatchWheelAt(element, targetAmount);
      }
      dispatchPageDown(element);

      if (element.scrollTop !== before) {
        moved = true;
      }
    }

    const beforeWindowY = window.scrollY;
    const windowAmount = Math.round(window.innerHeight * 1.15);
    window.scrollBy(0, windowAmount * 2);
    for (let index = 0; index < 2; index += 1) {
      dispatchWheelAt(document.body, windowAmount);
    }

    await wait(80);
    return moved || window.scrollY !== beforeWindowY;
  }

  async function collectSymbolsFromPage() {
    const symbols = [];
    const seen = new Set();
    let stagnantRounds = 0;
    const diagnostics = {
      rounds: 0,
      bestVisibleAnchors: 0,
      finalVisibleAnchors: 0,
      scrollTargets: 0
    };

    const append = (batch) => {
      const before = symbols.length;
      for (const symbol of batch) {
        if (!seen.has(symbol)) {
          seen.add(symbol);
          symbols.push(symbol);
        }
      }
      return symbols.length > before;
    };

    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll("main, aside, section, div, ul, [role='list'], [role='grid'], [role='table'], [data-testid]")) {
      if (element.scrollHeight > element.clientHeight + 20) {
        element.scrollTop = 0;
      }
    }

    await wait(350);

    let lastSignature = "";

    for (let round = 0; round < 55; round += 1) {
      diagnostics.rounds = round + 1;
      diagnostics.bestVisibleAnchors = Math.max(
        diagnostics.bestVisibleAnchors,
        visibleStockAnchors().length
      );

      const root = bestSymbolRoot();
      const grew = append(extractSymbolsFromPage(root)) || append(extractSymbolsFromPage());
      const signature = symbolSignature(symbols);
      stagnantRounds = grew ? 0 : stagnantRounds + 1;
      if (signature !== lastSignature) {
        lastSignature = signature;
        stagnantRounds = 0;
      }

      await scrollRobinhoodList();
      diagnostics.scrollTargets = Math.max(diagnostics.scrollTargets, stockListScrollTargets().length);
      await wait(120);

      if (round >= 5 && stagnantRounds >= 6) {
        break;
      }
    }

    diagnostics.finalVisibleAnchors = visibleStockAnchors().length;
    append(extractSymbolsFromPage(bestSymbolRoot()));
    append(extractSymbolsFromPage());
    return { symbols, diagnostics };
  }

  async function extractScreener(screenerName) {
    await waitForRobinhoodApp();

    if (!isLoggedIn()) {
      throw new Error("Log in to Robinhood in the opened Chrome tab, then return and refresh.");
    }

    const clicked = await clickListByName(screenerName);
    if (!clicked) {
      throw new Error(`Could not find Robinhood list named "${screenerName}".`);
    }

    await wait(900);
    const collected = await collectSymbolsFromPage();
    const symbols = collected.symbols;

    if (symbols.length === 0) {
      throw new Error(`Opened "${screenerName}", but no stock symbols were detected.`);
    }

    return {
      symbols,
      source: "robinhood",
      diagnostics: collected.diagnostics,
      url: window.location.href
    };
  }

  function parseMoney(text) {
    const match = String(text || "")
      .replace(/,/g, "")
      .match(/\$?\s*(-?\d+(?:\.\d+)?)/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function stockSymbolFromAnchor(anchor) {
    const match = String(anchor?.getAttribute?.("href") || "").match(
      /\/(?:stocks|etfs)\/([A-Z. -]{1,8})(?:[/?#]|$)/i
    );
    return match ? normalizeSymbol(match[1]) : null;
  }

  function isAccountInvestingPage() {
    return window.location.pathname.replace(/\/+$/, "") === "/account/investing";
  }

  function ensureAccountInvestingPage() {
    if (!isAccountInvestingPage()) {
      throw new Error(
        "CC Auto can import Robinhood stock positions only from https://robinhood.com/account/investing."
      );
    }
  }

  function parsePlainNumber(text) {
    const normalized = normalizeText(text).replace(/,/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return null;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseShares(text) {
    const normalized = normalizeText(text).replace(/,/g, "");
    const afterLabel = normalized.match(/\b(?:shares?|quantity|qty)\b[^\d]{0,30}(\d+(?:\.\d+)?)/i);
    if (afterLabel) {
      const parsed = Number.parseFloat(afterLabel[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }

    const beforeLabel = normalized.match(/(\d+(?:\.\d+)?)\s*(?:shares?|shs?)\b/i);
    if (beforeLabel) {
      const parsed = Number.parseFloat(beforeLabel[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  function parseSharesCell(text) {
    const plain = parsePlainNumber(text);
    if (Number.isFinite(plain)) {
      return plain;
    }

    return parseShares(text);
  }

  function parseAverageCost(text) {
    const normalized = normalizeText(text);
    const labeled = normalized.match(
      /\b(?:average\s+cost|avg\.?\s+cost|cost\s+basis)\b[^\d$-]{0,80}(\$?\s*-?\d[\d,]*(?:\.\d+)?)/i
    );
    if (labeled) {
      return parseMoney(labeled[1]);
    }

    const perShare = normalized.match(
      /(\$?\s*-?\d[\d,]*(?:\.\d+)?)\s*(?:average\s+cost|avg\.?\s+cost|cost\s+basis)\b/i
    );
    if (perShare) {
      return parseMoney(perShare[1]);
    }

    return null;
  }

  function isStockTableHeaderText(text) {
    return /^(?:name|symbol|shares|price|average cost|total return|equity)$/i.test(normalizeText(text));
  }

  function symbolFromSymbolCell(cell) {
    if (!cell) {
      return null;
    }

    const preferred = cell.querySelector?.('[class*="gic1rUwO9ldk9zzcggr7uA"]');
    const preferredSymbol = normalizeSymbol(preferred?.textContent || "");
    if (preferredSymbol) {
      return preferredSymbol;
    }

    const anchors = cell.querySelectorAll ? [...cell.querySelectorAll("a[href]")] : [];
    for (const anchor of anchors) {
      const symbol = stockSymbolFromAnchor(anchor);
      if (symbol) {
        return symbol;
      }
    }

    const tokens = normalizeText(cell.innerText || cell.textContent || "")
      .split(/\s+/)
      .map((token) => normalizeSymbol(token))
      .filter(Boolean);
    return tokens[0] || null;
  }

  function averageCostFromCell(cell) {
    if (!cell) {
      return null;
    }

    const preferred = cell.querySelector?.('[class*="URCNCRkOrsFeQ6BHrJU3Q"]');
    const preferredCost = parseMoney(preferred?.textContent || "");
    if (Number.isFinite(preferredCost)) {
      return preferredCost;
    }

    return parseAverageCost(cell.innerText || cell.textContent || "") ?? parseMoney(cell.innerText || cell.textContent || "");
  }

  function visibleTextElements(selector) {
    return [...document.querySelectorAll(selector)]
      .filter(visible)
      .map((element) => ({
        element,
        text: normalizeText(element.innerText || element.textContent || ""),
        rect: element.getBoundingClientRect()
      }))
      .filter(({ text }) => text);
  }

  function findStocksHeading() {
    return visibleTextElements("h1, h2, h3, h4, [role='heading'], div, span, p")
      .filter(({ text }) => /^stocks$/i.test(text))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.element || null;
  }

  function stockTableHeaderMap() {
    const heading = findStocksHeading();
    const headingRect = heading?.getBoundingClientRect?.();
    const minTop = headingRect ? headingRect.bottom - 4 : 0;
    const aliases = new Map([
      ["name", "name"],
      ["symbol", "symbol"],
      ["shares", "shares"],
      ["price", "price"],
      ["total return", "totalReturn"],
      ["equity", "equity"],
      ["average cost", "averageCost"]
    ]);
    const headers = new Map();

    for (const { element, text, rect } of visibleTextElements("th, [role='columnheader'], div, span, p")) {
      const key = aliases.get(text.toLowerCase());
      if (!key || rect.top < minTop) {
        continue;
      }

      const existing = headers.get(key);
      if (!existing || rect.top < existing.rect.top || (Math.abs(rect.top - existing.rect.top) <= 4 && rect.left < existing.rect.left)) {
        headers.set(key, {
          key,
          element,
          rect,
          center: rect.left + rect.width / 2
        });
      }
    }

    if (!headers.has("symbol") || !headers.has("shares") || !headers.has("averageCost")) {
      return null;
    }

    const headerBottom = Math.max(...[...headers.values()].map((header) => header.rect.bottom));
    return {
      heading,
      headerBottom,
      columns: [...headers.values()].sort((a, b) => a.center - b.center)
    };
  }

  function stockTableCellCandidates(headerMap) {
    const selectors = [
      '[class*="qVizNsgJursdUUgiZtoQzg"]',
      "td",
      "[role='cell']"
    ].join(", ");
    const candidates = [];
    const seen = new Set();

    for (const element of [...document.querySelectorAll(selectors)].filter(visible)) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);

      const text = normalizeText(element.innerText || element.textContent || "");
      const rect = element.getBoundingClientRect();
      if (!text || rect.top < headerMap.headerBottom - 1 || isStockTableHeaderText(text)) {
        continue;
      }

      candidates.push({
        element,
        text,
        rect,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      });
    }

    return candidates.sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
  }

  function groupStockCellsByRow(cells) {
    const rows = [];

    for (const cell of cells) {
      const existing = rows.find((row) => Math.abs(row.centerY - cell.centerY) <= 18);
      if (existing) {
        existing.cells.push(cell);
        existing.centerY = (existing.centerY * (existing.cells.length - 1) + cell.centerY) / existing.cells.length;
      } else {
        rows.push({
          centerY: cell.centerY,
          cells: [cell]
        });
      }
    }

    return rows.map((row) => ({
      ...row,
      cells: row.cells.sort((a, b) => a.centerX - b.centerX)
    }));
  }

  function nearestStockHeader(cell, columns) {
    return columns
      .map((column) => ({
        column,
        distance: Math.abs(column.center - cell.centerX)
      }))
      .sort((a, b) => a.distance - b.distance)[0]?.column || null;
  }

  function collectStockPositionsFromTable(accountName = currentAccountName()) {
    const headerMap = stockTableHeaderMap();
    if (!headerMap) {
      return [];
    }

    const positions = [];
    const seen = new Set();
    const rows = groupStockCellsByRow(stockTableCellCandidates(headerMap));

    for (const row of rows) {
      const cellsByColumn = new Map();
      for (const cell of row.cells) {
        const header = nearestStockHeader(cell, headerMap.columns);
        if (header && !cellsByColumn.has(header.key)) {
          cellsByColumn.set(header.key, cell.element);
        }
      }

      const symbolCell = cellsByColumn.get("symbol");
      const sharesCell = cellsByColumn.get("shares");
      const averageCostCell = cellsByColumn.get("averageCost");
      const symbol = symbolFromSymbolCell(symbolCell);
      const shares = parseSharesCell(sharesCell?.innerText || sharesCell?.textContent || "");
      const averageCost = averageCostFromCell(averageCostCell);

      if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(averageCost)) {
        continue;
      }

      const key = `${accountName}|${symbol}|${shares}|${averageCost}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      positions.push({
        accountName,
        symbol,
        shares,
        averageCost
      });
    }

    return positions;
  }

  function positionRowAncestor(anchor) {
    let current = anchor;
    let best = null;

    for (let depth = 0; current && depth < 10; depth += 1) {
      if (visible(current)) {
        const text = normalizeText(current.innerText || current.textContent || "");
        const shares = parseShares(text);
        const averageCost = parseAverageCost(text);
        const rect = current.getBoundingClientRect();
        const rowSized = rect.width >= 240 && rect.height >= 32 && rect.height <= 260;

        if (Number.isFinite(shares) && Number.isFinite(averageCost) && rowSized) {
          best = current;
        }
      }

      current = current.parentElement;
    }

    return best;
  }

  function currentAccountName() {
    const candidates = [...document.querySelectorAll("button, [role='button'], [aria-haspopup], [data-testid]")]
      .filter(visible)
      .map((element) => normalizeText(elementLabel(element)))
      .filter((label) =>
        /\b(?:individual|brokerage|ira|roth|traditional|margin|cash|retirement|account|investing)\b/i.test(label)
      )
      .sort((a, b) => a.length - b.length);

    return candidates[0] || "Robinhood";
  }

  function collectStockPositionsFromPage(accountName = currentAccountName()) {
    const tablePositions = collectStockPositionsFromTable(accountName);
    if (tablePositions.length > 0) {
      return tablePositions;
    }

    const positions = [];
    const seen = new Set();

    for (const anchor of stockAnchors(document).filter(visible)) {
      const symbol = stockSymbolFromAnchor(anchor);
      if (!symbol) {
        continue;
      }

      const row = positionRowAncestor(anchor);
      const text = normalizeText(row?.innerText || row?.textContent || "");
      const shares = parseShares(text);
      const averageCost = parseAverageCost(text);

      if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(averageCost)) {
        continue;
      }

      const key = `${accountName}|${symbol}|${shares}|${averageCost}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      positions.push({
        accountName,
        symbol,
        shares,
        averageCost
      });
    }

    return positions;
  }

  function accountDropdownCandidates() {
    return [...document.querySelectorAll("button, [role='button'], [aria-haspopup='menu'], [aria-haspopup='listbox']")]
      .filter((element) => {
        if (!visible(element)) {
          return false;
        }

        const label = elementLabel(element);
        if (!label || label.length > 80 || /\b(?:buy|sell|search|notifications?|settings|help|rewards|crypto)\b/i.test(label)) {
          return false;
        }

        return (
          /\b(?:account|individual|brokerage|ira|roth|traditional|margin|cash|retirement|investing|personal|joint)\b/i.test(label) ||
          element.matches?.("[aria-haspopup='menu'], [aria-haspopup='listbox']") ||
          Boolean(element.querySelector?.("svg"))
        );
      })
      .sort((a, b) => {
        const aLabel = elementLabel(a);
        const bLabel = elementLabel(b);
        const aAccount = /\baccount\b/i.test(aLabel) ? 0 : 1;
        const bAccount = /\baccount\b/i.test(bLabel) ? 0 : 1;
        const aPopup = a.matches?.("[aria-haspopup='menu'], [aria-haspopup='listbox']") ? 0 : 1;
        const bPopup = b.matches?.("[aria-haspopup='menu'], [aria-haspopup='listbox']") ? 0 : 1;
        return aAccount - bAccount || aPopup - bPopup || aLabel.length - bLabel.length;
      });
  }

  function accountChoiceLabel(element) {
    const labelNodes = element.querySelectorAll ? [...element.querySelectorAll("p, span")] : [];
    const preferred = labelNodes
      .map((candidate) => normalizeText(candidate.innerText || candidate.textContent || ""))
      .filter((label) =>
        label &&
        label.length <= 60 &&
        !/^(?:selected account|account selected)$/i.test(label) &&
        !/^\$?-?\d[\d,.]*%?$/.test(label)
      )[0];

    return preferred || elementLabel(element);
  }

  function isNonAccountGroupText(text) {
    return /^(?:stocks|name|symbol|shares|price|average cost|total return|equity|search|rewards|investing|crypto|portfolio overview|notifications|account|settings|help|history|transfers|recurring|stock lending|margin investing|reports and statements|tax center)$/i.test(
      normalizeText(text)
    );
  }

  function accountGroupHeadingFor(element) {
    const rect = element.getBoundingClientRect();
    const headings = visibleTextElements("div, span, p")
      .filter(({ element: candidate, text, rect: candidateRect }) => {
        if (
          candidate.closest?.("button, a, [role='button'], [role='menuitem'], [role='option']") ||
          text.length > 60 ||
          isNonAccountGroupText(text) ||
          candidateRect.bottom > rect.top + 6 ||
          candidateRect.bottom < rect.top - 110 ||
          Math.abs(candidateRect.left - rect.left) > 420
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.rect.bottom - a.rect.bottom || a.rect.left - b.rect.left);

    return headings[0]?.text || "";
  }

  function isNonAccountOptionText(text) {
    return /^(?:add|open|settings|statement|statements|transfer|transfers|support|help|tax center|history|search|rewards|crypto|notifications?|stocks|name|symbol|shares|price|average cost|total return|equity)$/i.test(
      normalizeText(text)
    );
  }

  function accountOptionDescriptors() {
    const descriptors = [];
    const occurrenceCounts = new Map();

    for (const element of [...document.querySelectorAll("button, [role='menuitem'], [role='option'], [role='button']")].filter(visible)) {
      const label = accountChoiceLabel(element);
      const group = accountGroupHeadingFor(element);
      if (!label || !group || label.length > 80 || isNonAccountOptionText(label)) {
        continue;
      }

      const baseKey = `${group}|${label}`;
      const occurrence = occurrenceCounts.get(baseKey) || 0;
      occurrenceCounts.set(baseKey, occurrence + 1);
      const displayName = label.toLowerCase() === group.toLowerCase()
        ? label
        : `${group} - ${label}`;
      descriptors.push({
        key: `${baseKey}|${occurrence}`,
        group,
        label,
        displayName,
        element
      });
    }

    return descriptors;
  }

  function clickAccountOption(option) {
    const target = accountOptionDescriptors()
      .filter((candidate) => candidate.key === option.key || (candidate.group === option.group && candidate.label === option.label))
      .sort((a, b) => candidateClickScore(a.element, a.label) - candidateClickScore(b.element, b.label))[0]?.element;
    if (!target) {
      return false;
    }

    clickLikeUser(target);
    return true;
  }

  async function openAccountDropdown() {
    for (const candidate of accountDropdownCandidates().slice(0, 8)) {
      clickLikeUser(candidate);
      await wait(400);
      if (accountOptionDescriptors().length > 0) {
        return true;
      }
    }

    return false;
  }

  function stockScrollTargets() {
    return [...document.querySelectorAll("main, [role='main'], [data-testid], section, div")]
      .filter((element) => {
        if (!visible(element)) {
          return false;
        }

        return element.scrollHeight > element.clientHeight + 40;
      })
      .sort((a, b) => {
        const aText = normalizeText(a.innerText || a.textContent || "");
        const bText = normalizeText(b.innerText || b.textContent || "");
        const aStocks = /\bstocks\b/i.test(aText) ? 0 : 1;
        const bStocks = /\bstocks\b/i.test(bText) ? 0 : 1;
        return aStocks - bStocks || b.clientHeight - a.clientHeight;
      });
  }

  function resetStockPositionScroll() {
    window.scrollTo(0, 0);
    for (const target of stockScrollTargets().slice(0, 4)) {
      target.scrollTop = 0;
    }
  }

  async function scrollStockPositionsPage() {
    for (const target of stockScrollTargets().slice(0, 4)) {
      target.scrollTop += Math.max(260, target.clientHeight * 0.75);
    }
    window.scrollBy(0, Math.max(360, window.innerHeight * 0.75));
    await wait(180);
  }

  async function collectStockPositionsForAccount(accountName) {
    const positions = [];
    const seen = new Set();
    let stagnantRounds = 0;

    resetStockPositionScroll();
    await wait(120);

    for (let round = 0; round < 28 && stagnantRounds < 5; round += 1) {
      ensureAccountInvestingPage();
      let added = 0;

      for (const position of collectStockPositionsFromPage(accountName)) {
        const key = `${position.accountName}|${position.symbol}|${position.shares}|${position.averageCost}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        positions.push(position);
        added += 1;
      }

      stagnantRounds = added > 0 ? 0 : stagnantRounds + 1;
      await scrollStockPositionsPage();
    }

    return positions;
  }

  async function extractStockPositions() {
    await waitForRobinhoodApp();
    ensureAccountInvestingPage();

    if (!isLoggedIn()) {
      throw new Error("Log in to Robinhood in the opened Chrome tab, then return and refresh.");
    }

    const positions = [];
    const seenRows = new Set();
    const collect = (accountName = currentAccountName()) => {
      for (const position of collectStockPositionsFromPage(accountName)) {
        const key = `${position.accountName}|${position.symbol}|${position.shares}|${position.averageCost}`;
        if (!seenRows.has(key)) {
          seenRows.add(key);
          positions.push(position);
        }
      }
    };

    await wait(900);

    if (await openAccountDropdown()) {
      const accountOptions = accountOptionDescriptors();
      for (const option of accountOptions) {
        if (accountOptionDescriptors().length === 0 && !(await openAccountDropdown())) {
          break;
        }
        if (!clickAccountOption(option)) {
          continue;
        }
        await wait(1200);
        ensureAccountInvestingPage();
        collect(option.displayName);
        for (const position of await collectStockPositionsForAccount(option.displayName)) {
          const key = `${position.accountName}|${position.symbol}|${position.shares}|${position.averageCost}`;
          if (!seenRows.has(key)) {
            seenRows.add(key);
            positions.push(position);
          }
        }
      }
    } else {
      for (const position of await collectStockPositionsForAccount(currentAccountName())) {
        const key = `${position.accountName}|${position.symbol}|${position.shares}|${position.averageCost}`;
        if (!seenRows.has(key)) {
          seenRows.add(key);
          positions.push(position);
        }
      }
    }

    if (positions.length === 0) {
      throw new Error("No stock positions with shares and average cost were detected.");
    }

    return {
      positions,
      source: "robinhood-positions",
      url: window.location.href
    };
  }

  function optionButtonCandidates(label) {
    const target = normalizeText(label);
    return [...document.querySelectorAll("button, [role='button']")]
      .filter((element) => {
        if (!visible(element)) {
          return false;
        }

        const text = normalizeText(element.textContent);
        const ariaLabel = normalizeText(element.getAttribute?.("aria-label") || "");
        return text === target || ariaLabel === target;
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.top - bRect.top || aRect.left - bRect.left;
      });
  }

  async function clickOptionToggle(label) {
    const candidate = optionButtonCandidates(label)[0];
    if (!candidate) {
      return false;
    }

    clickLikeUser(candidate);
    await wait(350);
    return true;
  }

  async function dismissOptionsNotice() {
    const dismiss = optionButtonCandidates("Dismiss")[0];
    if (dismiss) {
      clickLikeUser(dismiss);
      await wait(150);
    }
  }

  function currentOptionsChainSymbol() {
    return decodeURIComponent(
      window.location.pathname.match(/\/options\/chains\/([^/?#]+)/i)?.[1] || ""
    ).toUpperCase();
  }

  function visibleHeadingText() {
    return normalizeText(
      [...document.querySelectorAll("h1, h2, [role='heading']")]
        .filter(visible)
        .map((element) => element.textContent || "")
        .join(" ")
    );
  }

  function optionModeMatches(symbol, side, type) {
    const expectedSymbol = String(symbol || "").trim().toUpperCase();
    const heading = visibleHeadingText();
    return new RegExp(`\\b${expectedSymbol}\\b\\s+${side}\\s+${type}\\b`, "i").test(heading);
  }

  function optionSideMatches(symbol, side) {
    const expectedSymbol = String(symbol || "").trim().toUpperCase();
    const heading = visibleHeadingText();
    return new RegExp(`\\b${expectedSymbol}\\b\\s+${side}\\s+(?:call|put)\\b`, "i").test(heading);
  }

  async function waitForOptionsChain(symbol) {
    const expectedSymbol = String(symbol || "").trim().toUpperCase();

    for (let attempt = 0; attempt < 70; attempt += 1) {
      const text = normalizeText(document.body?.innerText || "");
      if (
        currentOptionsChainSymbol() === expectedSymbol &&
        new RegExp(`\\b${expectedSymbol}\\b`, "i").test(text) &&
        /Strike price/i.test(text) &&
        /(Ask Price|Bid Price)/i.test(text)
      ) {
        return true;
      }
      await wait(200);
    }

    return false;
  }

  async function ensureOptionSide(symbol, side) {
    if (optionSideMatches(symbol, side)) {
      return true;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!(await clickOptionToggle(side[0].toUpperCase() + side.slice(1)))) {
        return false;
      }

      for (let poll = 0; poll < 12; poll += 1) {
        if (optionSideMatches(symbol, side)) {
          return true;
        }
        await wait(150);
      }
    }

    return false;
  }

  async function ensureOptionMode(symbol, side, type) {
    if (optionModeMatches(symbol, side, type)) {
      return true;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!(await clickOptionToggle(type[0].toUpperCase() + type.slice(1)))) {
        return false;
      }

      for (let poll = 0; poll < 12; poll += 1) {
        if (optionModeMatches(symbol, side, type)) {
          return true;
        }
        await wait(150);
      }
    }

    return false;
  }

  async function waitForStableOptionRows() {
    let lastSignature = "";
    let stableRounds = 0;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const snapshot = new Map();
      addVisibleButtonQuotes(snapshot);
      const signature = quoteSignature([...snapshot.values()]);

      if (signature && signature === lastSignature) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      if (signature && stableRounds >= 2) {
        return true;
      }

      lastSignature = signature;
      await wait(150);
    }

    return Boolean(lastSignature);
  }

  function parseStrikeFromText(text) {
    const normalized = normalizeText(text);
    if (!/^\$?\d+(?:\.\d+)?$/.test(normalized)) {
      return null;
    }

    return parseMoney(normalized);
  }

  function findStrikeNearButton(button) {
    const buttonRect = button.getBoundingClientRect();
    const buttonMidY = buttonRect.top + buttonRect.height / 2;
    const sameRowBand = Math.max(28, Math.min(58, buttonRect.height * 0.85 + 16));
    const candidates = [...document.querySelectorAll("h1, h2, h3, h4, [role='heading'], div, span")]
      .filter((element) => {
        if (!visible(element) || element === button || button.contains(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        if (
          rect.left >= buttonRect.left ||
          rect.right > buttonRect.left + 8 ||
          rect.width > 220 ||
          rect.height > 80
        ) {
          return false;
        }

        const value = parseStrikeFromText(element.textContent);
        return Number.isFinite(value) && Math.abs(rect.top + rect.height / 2 - buttonMidY) <= sameRowBand;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const yDelta = Math.abs(rect.top + rect.height / 2 - buttonMidY);
        return {
          value: parseStrikeFromText(element.textContent),
          yDelta,
          yBucket: Math.round(yDelta / 8),
          left: rect.left
        };
      })
      .sort((a, b) => a.yBucket - b.yBucket || a.left - b.left || a.yDelta - b.yDelta);

    return candidates[0]?.value ?? null;
  }

  function addQuote(quotesByKey, quote) {
    if (!Number.isFinite(quote?.strike) || !Number.isFinite(quote?.bid) || quote.strike <= 0 || quote.bid < 0) {
      return false;
    }

    const key = String(quote.strike);
    const existing = quotesByKey.get(key);
    if (existing && quote.bid <= existing.bid) {
      return false;
    }

    quotesByKey.set(key, {
      strike: quote.strike,
      bid: quote.bid,
      rawText: quote.rawText || `strike ${quote.strike} price ${quote.bid}`
    });
    return true;
  }

  function addVisibleButtonQuotes(quotesByKey) {
    let added = false;

    for (const button of visibleOptionButtons()) {
      const bid = parseMoney(button.textContent);
      const strike = findStrikeNearButton(button);
      if (!Number.isFinite(strike) || !Number.isFinite(bid) || strike <= 0 || bid < 0) {
        continue;
      }

      added = addQuote(quotesByKey, {
        strike,
        bid,
        rawText: `strike ${strike} price ${bid}`
      }) || added;
    }

    return added;
  }

  function optionButtonsIn(element) {
    const buttons = visibleOptionButtons();
    if (!element) {
      return [];
    }

    return buttons.filter((button) => element === button || element.contains?.(button));
  }

  function optionScrollScore(element) {
    if (!element || !visible(element)) {
      return -1;
    }

    const buttonCount = optionButtonsIn(element).length;
    const scrollDistance = Math.max(0, element.scrollHeight - element.clientHeight);
    const rect = element.getBoundingClientRect();
    const usableSize = rect.height > 120 && rect.width > 360 ? 1 : 0;
    const scrollable = scrollDistance > 20 ? 1 : 0;

    return buttonCount * 2000 + scrollable * 500 + usableSize * 100 + Math.min(scrollDistance / 20, 100);
  }

  function optionScrollTargets() {
    const targets = [];

    for (const button of visibleOptionButtons()) {
      let current = button;
      for (let depth = 0; current && depth < 12; depth += 1) {
        targets.push(current);
        current = current.parentElement;
      }
    }

    targets.push(document.scrollingElement, document.documentElement, document.body);

    return uniqueElements(targets)
      .filter((element) => {
        if (!element || !visible(element)) {
          return false;
        }

        return optionButtonsIn(element).length > 0 && element.scrollHeight > element.clientHeight + 20;
      })
      .sort((a, b) => optionScrollScore(b) - optionScrollScore(a))
      .slice(0, 4);
  }

  function primaryOptionScrollTarget() {
    return optionScrollTargets()[0] || document.scrollingElement || document.documentElement || document.body;
  }

  function scrollTargetName(element) {
    if (!element) {
      return "none";
    }
    if (element === document.scrollingElement) {
      return "document.scrollingElement";
    }
    if (element === document.documentElement) {
      return "documentElement";
    }
    if (element === document.body) {
      return "body";
    }
    const parts = [element.tagName?.toLowerCase()].filter(Boolean);
    if (element.id) {
      parts.push(`#${element.id}`);
    }
    if (typeof element.className === "string" && element.className.trim()) {
      parts.push(`.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`);
    }
    return parts.join("") || "element";
  }

  function scrollTargetState(element) {
    if (!element) {
      return { top: 0, maxTop: 0, atStart: true, atEnd: true };
    }
    const top =
      element === document.body
        ? Math.max(document.body.scrollTop, document.documentElement.scrollTop, window.scrollY)
        : element.scrollTop;
    const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);

    return {
      top,
      maxTop,
      atStart: top <= 2,
      atEnd: maxTop - top <= 2
    };
  }

  function quoteSignature(quotes) {
    return [...quotes]
      .sort((a, b) => a.strike - b.strike)
      .map((quote) => `${quote.strike}:${quote.bid}`)
      .join("|");
  }

  function visibleOptionButtons() {
    return [...document.querySelectorAll('[data-testid="OptionChainSelectRowButton"]')].filter(visible);
  }

  function optionScrollSnapshot(primaryTarget = primaryOptionScrollTarget()) {
    return {
      windowY: window.scrollY,
      targets: uniqueElements([primaryTarget, ...optionScrollTargets()]).map((element) => ({
        element,
        scrollTop: element.scrollTop
      }))
    };
  }

  async function restoreOptionScrollSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    for (const { element, scrollTop } of snapshot.targets || []) {
      if (element) {
        element.scrollTop = scrollTop;
      }
    }

    window.scrollTo(0, snapshot.windowY || 0);
    await wait(250);
  }

  async function scrollOptionsChain(direction = 1, primaryTarget = primaryOptionScrollTarget()) {
    const step = Math.max(650, Math.min(1100, Math.round(window.innerHeight * 0.85)));
    const amount = step * direction;
    const focus =
      [...visibleOptionButtons()].sort((a, b) =>
        direction > 0
          ? b.getBoundingClientRect().top - a.getBoundingClientRect().top
          : a.getBoundingClientRect().top - b.getBoundingClientRect().top
      )[0] || document.body;

    const element = primaryTarget || document.scrollingElement || document.documentElement || document.body;
    const before = scrollTargetState(element).top;
    const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const next = Math.max(0, Math.min(before + amount, maxTop));

    if (next !== before) {
      element.scrollTop = next;
      dispatchWheelAt(focus, amount);
      await wait(90);
      return true;
    }

    const beforeWindowY = window.scrollY;
    window.scrollBy(0, amount);
    dispatchWheelAt(focus, amount);
    await wait(90);

    return window.scrollY !== beforeWindowY;
  }

  function optionQuoteStats(quotesByKey) {
    const strikes = [...quotesByKey.values()]
      .map((quote) => quote.strike)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    return {
      minStrike: strikes[0] ?? null,
      maxStrike: strikes.at(-1) ?? null
    };
  }

  async function collectOptionSweep(quotesByKey, diagnostics, direction, maxRounds, primaryTarget) {
    let stagnantRounds = 0;
    let lastSignature = quoteSignature([...quotesByKey.values()]);

    for (let round = 0; round < maxRounds; round += 1) {
      diagnostics.rounds += 1;
      diagnostics.maxVisibleButtons = Math.max(
        diagnostics.maxVisibleButtons,
        visibleOptionButtons().length
      );
      diagnostics.maxVisibleRows = diagnostics.maxVisibleButtons;

      const added = addVisibleButtonQuotes(quotesByKey);
      const signature = quoteSignature([...quotesByKey.values()]);
      stagnantRounds = added || signature !== lastSignature ? 0 : stagnantRounds + 1;
      lastSignature = signature;

      const beforeState = scrollTargetState(primaryTarget);
      const moved = await scrollOptionsChain(direction, primaryTarget);
      const afterState = scrollTargetState(primaryTarget);
      if (moved) {
        diagnostics.scrollMoves += 1;
      }
      await wait(45);

      if (direction < 0 && afterState.atStart && stagnantRounds >= 2) {
        diagnostics.reachedTop = true;
        break;
      }

      if (direction > 0 && afterState.atEnd && stagnantRounds >= 3) {
        diagnostics.reachedBottom = true;
        break;
      }

      if (!moved && stagnantRounds >= 3) {
        if (direction > 0) {
          diagnostics.reachedBottom = afterState.atEnd || beforeState.atEnd;
        }
        break;
      }
    }
  }

  async function collectOptionQuotes() {
    const quotesByKey = new Map();
    const diagnostics = {
      rounds: 0,
      maxVisibleRows: 0,
      maxVisibleButtons: 0,
      scrollMoves: 0,
      initialVisibleButtons: 0,
      initialQuotes: 0,
      scrollTargets: 0,
      primaryScrollTarget: null,
      reachedTop: false,
      reachedBottom: false,
      quotesFound: 0,
      minStrike: null,
      maxStrike: null,
      finalUrl: window.location.href,
      detectedHeading: visibleHeadingText()
    };

    diagnostics.initialVisibleButtons = visibleOptionButtons().length;
    addVisibleButtonQuotes(quotesByKey);
    diagnostics.initialQuotes = quotesByKey.size;
    diagnostics.scrollTargets = optionScrollTargets().length;
    const primaryTarget = primaryOptionScrollTarget();
    diagnostics.primaryScrollTarget = scrollTargetName(primaryTarget);

    const initialScrollSnapshot = optionScrollSnapshot(primaryTarget);
    await collectOptionSweep(quotesByKey, diagnostics, -1, 10, primaryTarget);
    await restoreOptionScrollSnapshot(initialScrollSnapshot);
    addVisibleButtonQuotes(quotesByKey);
    await collectOptionSweep(quotesByKey, diagnostics, 1, 72, primaryTarget);
    addVisibleButtonQuotes(quotesByKey);

    const stats = optionQuoteStats(quotesByKey);
    diagnostics.quotesFound = quotesByKey.size;
    diagnostics.minStrike = stats.minStrike;
    diagnostics.maxStrike = stats.maxStrike;
    diagnostics.finalUrl = window.location.href;
    diagnostics.detectedHeading = visibleHeadingText();

    return {
      quotes: [...quotesByKey.values()].sort((a, b) => a.strike - b.strike),
      diagnostics
    };
  }

  async function extractOptionQuotes(symbol, currentPrice, optionType) {
    const normalizedType = optionType === "call" ? "call" : "put";
    const optionLabel = normalizedType === "call" ? "Call" : "Put";
    await waitForRobinhoodApp();

    if (!isLoggedIn()) {
      throw new Error("Log in to Robinhood in the opened Chrome tab, then return and refresh.");
    }

    const chainLoaded = await waitForOptionsChain(symbol);
    if (!chainLoaded) {
      throw new Error("Robinhood option chain did not load.");
    }
    if (!(await ensureOptionSide(symbol, "sell"))) {
      throw new Error("Could not select Sell on the Robinhood option chain.");
    }
    if (!(await ensureOptionMode(symbol, "sell", normalizedType))) {
      throw new Error(`Could not select ${optionLabel} on the Robinhood option chain.`);
    }
    await dismissOptionsNotice();
    await waitForOptionsChain(symbol);
    await waitForStableOptionRows();

    const collected = await collectOptionQuotes();

    if (collected.quotes.length === 0) {
      throw new Error("No Robinhood option rows were detected for this symbol.");
    }

    return {
      symbol,
      currentPrice,
      optionType: normalizedType,
      quotes: collected.quotes,
      diagnostics: collected.diagnostics,
      url: window.location.href
    };
  }

  function extractPutOptionQuotes(symbol, currentPrice) {
    return extractOptionQuotes(symbol, currentPrice, "put");
  }

  function extractCallOptionQuotes(symbol, currentPrice) {
    return extractOptionQuotes(symbol, currentPrice, "call");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === "status") {
      sendResponse({
        loggedIn: isLoggedIn(),
        url: window.location.href
      });
      return true;
    }

    if (message?.action === "extractScreener") {
      extractScreener(message.screenerName)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    if (message?.action === "extractStockPositions") {
      extractStockPositions()
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    if (message?.action === "extractPutOptionQuotes") {
      extractPutOptionQuotes(message.symbol, message.currentPrice)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    if (message?.action === "extractCallOptionQuotes") {
      extractCallOptionQuotes(message.symbol, message.currentPrice)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    return false;
  });
})();
