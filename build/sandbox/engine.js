import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

document.addEventListener("DOMContentLoaded", async () => {
  const logEl     = document.getElementById("log");
  const userInput = document.getElementById("userInput");
  const sendBtn   = document.getElementById("sendBtn");

  if (!logEl || !userInput || !sendBtn) {
    console.error("Missing required DOM elements—check your IDs");
    return;
  }

  // Disable button during initialization
  sendBtn.disabled = true;

  // Enhanced logging with message styling
  function log(msg, type = "system") {
    const messageEl = document.createElement("div");
    messageEl.className = `message message-${type}`;
    
    // Handle different message types
    if (type === "you" || type === "assistant") {
      const prefix = type === "you" ? "You: " : "Assistant: ";
      messageEl.textContent = prefix + msg;
    } else if (type === "loading") {
      messageEl.innerHTML = `<span class="loading-indicator">${msg}</span>`;
      messageEl.id = "loading-message";
    } else {
      messageEl.textContent = msg;
    }
    
    logEl.appendChild(messageEl);
    logEl.scrollTop = logEl.scrollHeight;
    return messageEl;
  }
  
  // Show initial loading state
  log("Initializing WebLLM engine...", "loading");

  const initProgressCallback = (report) => {
    const pct = (report.progress * 100).toFixed(1);
    const loadingMsg = document.getElementById("loading-message");
    if (loadingMsg) {
      loadingMsg.innerHTML = `<span class="loading-indicator">Loading: ${pct}% — ${report.text}</span>`;
    }
  };

  let engine;
  try {
    engine = await CreateMLCEngine(
      "SmolLM2-360M-Instruct-q0f16-MLC",
      { initProgressCallback }
    );
    
    // Replace loading message with success message
    const loadingMsg = document.getElementById("loading-message");
    if (loadingMsg) {
      loadingMsg.className = "message message-system";
      loadingMsg.innerHTML = "✅ Engine ready! Type a message to start chatting.";
    } else {
      log("✅ Engine ready! Type a message to start chatting.");
    }
  } catch (e) {
    console.error(e);
    const loadingMsg = document.getElementById("loading-message");
    if (loadingMsg) {
      loadingMsg.className = "message message-system";
      loadingMsg.innerHTML = `❌ Failed to load engine: ${e.message}`;
    } else {
      log(`❌ Failed to load engine: ${e.message}`);
    }
    return;
  } finally {
    sendBtn.disabled = false;
  }

  // Support for pressing Enter key to send
  userInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !sendBtn.disabled) {
      sendBtn.click();
    }
  });

  sendBtn.addEventListener("click", async () => {
    const text = userInput.value.trim();
    if (!text) return;
    userInput.value = "";
    
    // Add user message
    log(text, "you");
    
    // Show loading indicator
    const loadingEl = log("Thinking...", "loading");
    sendBtn.disabled = true;

    try {
      // Non‐streaming call:
      const resp = await engine.chat.completions.create({
        messages: [{ role: "user", content: text }],
      });

      // Remove loading message and add assistant response
      loadingEl.remove();
      const answer = resp.choices[0]?.message?.content || "[no response]";
      log(answer, "assistant");
    } catch (err) {
      console.error(err);
      loadingEl.remove();
      log(`❌ Error: ${err.message}`, "system");
    } finally {
      sendBtn.disabled = false;
      userInput.focus();
    }
  });

  // Focus the input field on load
  userInput.focus();
});
