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
    const targets = [...new Set([pointTarget, element].filter(Boolean))];

    for (const target of targets) {
      for (const type of ["pointerover", "mouseover", "pointermove", "mousemove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
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

      target.click?.();
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

  async function extractPutOptionQuotes(symbol, currentPrice) {
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
    if (!(await ensureOptionMode(symbol, "sell", "put"))) {
      throw new Error("Could not select Put on the Robinhood option chain.");
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
      quotes: collected.quotes,
      diagnostics: collected.diagnostics,
      url: window.location.href
    };
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

    if (message?.action === "extractPutOptionQuotes") {
      extractPutOptionQuotes(message.symbol, message.currentPrice)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }

    return false;
  });
})();
