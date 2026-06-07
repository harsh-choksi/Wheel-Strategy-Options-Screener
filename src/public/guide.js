const copyStatus = document.querySelector("#copyStatus");

async function copyScreenerName(button) {
  const value = button.dataset.copy;

  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    copyStatus.textContent = `${value} copied to clipboard.`;

    setTimeout(() => {
      button.textContent = "Copy";
    }, 1600);
  } catch {
    copyStatus.textContent = `Select and copy this name: ${value}`;
  }
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", () => copyScreenerName(button));
}
