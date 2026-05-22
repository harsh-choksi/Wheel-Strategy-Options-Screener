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

    return false;
  });
})();
