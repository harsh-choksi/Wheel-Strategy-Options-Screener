(() => {
  if (window.__wheelScreenerAppBridge) {
    return;
  }

  window.__wheelScreenerAppBridge = true;

  const REQUEST_TYPE = "WHEEL_SCREENER_EXTENSION_REQUEST";
  const RESPONSE_TYPE = "WHEEL_SCREENER_EXTENSION_RESPONSE";
  const READY_TYPE = "WHEEL_SCREENER_EXTENSION_READY";

  function announceReady() {
    window.postMessage(
      {
        type: READY_TYPE,
        version: chrome.runtime.getManifest().version
      },
      window.location.origin
    );
  }

  announceReady();
  setTimeout(announceReady, 250);
  setTimeout(announceReady, 1000);

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.type !== REQUEST_TYPE) {
      return;
    }

    const { id, action, payload } = event.data;

    try {
      const response = await chrome.runtime.sendMessage({
        action,
        payload: payload || {}
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      window.postMessage(
        {
          type: RESPONSE_TYPE,
          id,
          ok: true,
          payload: response
        },
        window.location.origin
      );
    } catch (error) {
      window.postMessage(
        {
          type: RESPONSE_TYPE,
          id,
          ok: false,
          error: error.message
        },
        window.location.origin
      );
    }
  });
})();
