import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

document.addEventListener("DOMContentLoaded", async () => {
  const logEl     = document.getElementById("log");
  const userInput = document.getElementById("userInput");
  const sendBtn   = document.getElementById("sendBtn");

  if (!logEl || !userInput || !sendBtn) {
    console.error("Missing required DOM elements—check your IDs");
    return;
  }

  function log(msg) {
    logEl.innerText += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  sendBtn.disabled = true;
  log("🔄 Initializing engine…");

  const initProgressCallback = (report) => {
    const pct = (report.progress * 100).toFixed(1);
    log(`Loading: ${pct}% — ${report.text}`);
  };

  let engine;
  try {
    engine = await CreateMLCEngine(
      "SmolLM2-360M-Instruct-q0f16-MLC",
      { initProgressCallback }
    );
    log("✅ Engine ready!");
  } catch (e) {
    console.error(e);
    log(`❌ Failed to load engine: ${e.message}`);
    return;
  } finally {
    sendBtn.disabled = false;
  }

  sendBtn.addEventListener("click", async () => {
    const text = userInput.value.trim();
    if (!text) return;
    userInput.value = "";
    log(`You: ${text}`);
    sendBtn.disabled = true;

    try {
      // Non‐streaming call:
      const resp = await engine.chat.completions.create({
        messages: [{ role: "user", content: text }],
      });

      const answer = resp.choices[0]?.message?.content || "[no response]";
      log(`Assistant: ${answer}`);
    } catch (err) {
      console.error(err);
      log(`❌ Error: ${err.message}`);
    } finally {
      sendBtn.disabled = false;
    }
  });
});
