const REQUEST_TYPE = "WHEEL_SCREENER_EXTENSION_REQUEST";
const RESPONSE_TYPE = "WHEEL_SCREENER_EXTENSION_RESPONSE";
let requestId = 0;

const healthGrid = document.querySelector("#healthGrid");
const healthSummary = document.querySelector("#healthSummary");
const rerunButton = document.querySelector("#rerunHealthButton");

function requestExtension(action, payload = {}, timeoutMs = 2500) {
  const id = `health-${Date.now()}-${requestId++}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The Chrome helper did not answer."));
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window || event.data?.type !== RESPONSE_TYPE || event.data.id !== id) {
        return;
      }

      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);

      if (!event.data.ok) {
        reject(new Error(event.data.error || "The Chrome helper returned an error."));
        return;
      }

      resolve(event.data.payload || {});
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        type: REQUEST_TYPE,
        id,
        action,
        payload
      },
      window.location.origin
    );
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusCard({ title, status, message, detail }) {
  const safeDetail = detail ? `<small>${escapeHtml(detail)}</small>` : "";
  return `
    <article class="health-card ${status}">
      <span class="status-dot" aria-hidden="true"></span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${safeDetail}
    </article>
  `;
}

async function checkServerHealth() {
  const response = await fetch("/healthz", {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Health endpoint returned HTTP ${response.status}.`);
  }

  return response.json();
}

async function runChecks() {
  rerunButton.disabled = true;
  healthSummary.textContent = "Checking helper and server status...";
  healthGrid.innerHTML = `
    ${statusCard({
      title: "Extension bridge",
      status: "pending",
      message: "Waiting for helper response."
    })}
    ${statusCard({
      title: "App server",
      status: "pending",
      message: "Checking public health endpoint."
    })}
  `;

  const [helperResult, serverResult] = await Promise.allSettled([
    requestExtension("status", {}, 3000),
    checkServerHealth()
  ]);

  const cards = [];

  if (helperResult.status === "fulfilled") {
    const status = helperResult.value;
    cards.push(
      statusCard({
        title: "Extension bridge",
        status: "ok",
        message: `Helper version ${status.version || "unknown"} answered.`
      })
    );
    cards.push(
      statusCard({
        title: "Robinhood tab",
        status: status.hasRobinhoodTab ? "ok" : "warn",
        message: status.hasRobinhoodTab
          ? "A Robinhood tab is open in Chrome."
          : "No Robinhood tab was found.",
        detail: status.robinhoodUrl || "Open Robinhood before live scans."
      })
    );
    cards.push(
      statusCard({
        title: "CC Auto route",
        status: status.onInvestingPage ? "ok" : "warn",
        message: status.onInvestingPage
          ? "The open Robinhood tab is on the Investing page."
          : "CC Auto reads positions from /account/investing.",
        detail: "Use Open Robinhood or visit https://robinhood.com/account/investing before scanning."
      })
    );
  } else {
    cards.push(
      statusCard({
        title: "Extension bridge",
        status: "error",
        message: helperResult.reason.message,
        detail: "Reload or reinstall the unpacked helper, then refresh this page."
      })
    );
    cards.push(
      statusCard({
        title: "Robinhood tab",
        status: "warn",
        message: "Robinhood route could not be checked until the helper answers."
      })
    );
    cards.push(
      statusCard({
        title: "CC Auto route",
        status: "warn",
        message: "CC Auto route could not be checked until the helper answers."
      })
    );
  }

  if (serverResult.status === "fulfilled") {
    const health = serverResult.value;
    cards.push(
      statusCard({
        title: "App server",
        status: "ok",
        message: `Server is healthy on ${health.nodeEnv || "unknown"} environment.`,
        detail: `App ${health.appVersion || "unknown"} / helper ${health.helperVersion || "unknown"}`
      })
    );
  } else {
    cards.push(
      statusCard({
        title: "App server",
        status: "error",
        message: serverResult.reason.message,
        detail: "Check Docker logs and the /healthz route on the deployed site."
      })
    );
  }

  healthGrid.innerHTML = cards.join("");
  const hasError = cards.some((card) => card.includes("health-card error"));
  const hasWarn = cards.some((card) => card.includes("health-card warn"));
  healthSummary.textContent = hasError
    ? "One or more checks failed."
    : hasWarn
      ? "Helper is reachable, but one or more scan readiness checks need attention."
      : "All helper and server checks passed.";
  rerunButton.disabled = false;
}

rerunButton.addEventListener("click", runChecks);
runChecks().catch((error) => {
  healthSummary.textContent = error.message;
  rerunButton.disabled = false;
});
