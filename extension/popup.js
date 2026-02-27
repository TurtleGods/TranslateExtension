const statusNode = document.getElementById("status");
const button = document.getElementById("generateButton");
const languageInput = document.getElementById("targetLanguage");

button.addEventListener("click", async () => {
  const targetLanguage = languageInput.value.trim();
  if (!targetLanguage) {
    setStatus("Enter a target language first.", true);
    return;
  }

  button.disabled = true;
  setStatus("Generating subtitles...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_SUBTITLES",
      targetLanguage
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The extension did not receive a response.");
    }

    setStatus(
      `Attached ${response.payload.segment_count} subtitle lines as ${response.payload.track_label}.`
    );
  } catch (error) {
    setStatus(error.message || "Failed to generate subtitles.", true);
  } finally {
    button.disabled = false;
  }
});

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}
