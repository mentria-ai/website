// tiny helper
const $ = s => document.querySelector(s);
const chatBox   = $('#chat');
const loadingEl = $('#loading');
const progress  = $('#progress');
const form      = $('#prompt-form');
const promptBox = $('#prompt');

let engine;
let history = [];          // OpenAI-style chat history
let isEngineReady = false;

(async () => {
  try {
    // 1. Load model with progress feedback
    engine = await webllm.CreateMLCEngine(
        "Qwen3-1.7B-q4f16_1-MLC",
        {initProgressCallback: p => progress.textContent = Math.round(p.progress*100)+' %'}
    );
    isEngineReady = true;
    loadingEl.remove();      // ready!

    // initial greeting
    addMsg("ai","Hi 👋 I'm **Qwen3 1.7B** running fully in your browser!\n\n✨ **New features:**\n- Press `Enter` to send (Shift+Enter for new lines)\n- Watch my **thinking process** in real-time (italics) then collapsed\n- Full **markdown** support: `code`, **bold**, *italic*, links!\n\nTry asking me something complex to see my thinking! 🧠");
    
    // Add reset button
    addResetButton();
  } catch (err) {
    console.error('Engine initialization failed:', err);
    loadingEl.textContent = "Failed to load model. WebGPU may not be available on this device.";
  }
})();

// 2. Handle user input
form.addEventListener('submit', async e => {
  e.preventDefault();
  await sendMessage();
});

// Handle Enter key to send message (Shift+Enter for new line)
promptBox.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    await sendMessage();
  }
});

// Process AI response to handle thinking tags and markdown
function processAIResponse(content) {
  // First, handle thinking tags (this returns HTML)
  return processThinkingTags(content);
}

// Fast streaming processing - minimal overhead for performance
function processStreamingFast(content) {
  // Quick check if we're inside a thinking tag (minimal string operations)
  const lastThinkOpen = content.lastIndexOf('<think>');
  const lastThinkClose = content.lastIndexOf('</think>');
  
  // If we're inside an unclosed thinking tag
  if (lastThinkOpen > lastThinkClose) {
    // Split at the last opening think tag
    const beforeThink = content.substring(0, lastThinkOpen);
    const thinkingPart = content.substring(lastThinkOpen + 7); // +7 for '<think>'
    
    // Minimal processing - just escape HTML and style thinking
    const escapedBefore = escapeHtml(beforeThink);
    const escapedThinking = thinkingPart.trim() || "Thinking...";
    
    return escapedBefore + 
           `<div class="live-thinking">💭 <em>${escapeHtml(escapedThinking)}</em></div>`;
  } else {
    // Not in thinking mode - just escape and return
    return escapeHtml(content);
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Process thinking tags into collapsible accordions
function processThinkingTags(content) {
  // Split content by thinking tags
  const parts = content.split(/<think>([\s\S]*?)<\/think>/g);
  let result = '';
  
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Even indices are regular content (not thinking)
      if (parts[i].trim()) {
        result += renderMarkdown(parts[i]);
      }
    } else {
      // Odd indices are thinking content
      const thinkContent = parts[i];
      const thinkId = 'think-' + Math.random().toString(36).substr(2, 9);
      result += `<details class="thinking-accordion" id="${thinkId}">
        <summary class="thinking-summary" aria-expanded="false" role="button" tabindex="0">
          💭 Thinking process
          <span class="accordion-icon" aria-hidden="true">▼</span>
        </summary>
        <div class="thinking-content" role="region" aria-labelledby="${thinkId}-summary">
          ${renderMarkdown(thinkContent.trim())}
        </div>
      </details>`;
    }
  }
  
  return result;
}

// Simple markdown renderer for common formatting
function renderMarkdown(text) {
  if (!text) return '';
  
  // Escape HTML first, then apply markdown
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Code blocks (``` or `)
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold and italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

async function sendMessage() {
  const text = promptBox.value.trim();
  if (!text || !isEngineReady) return;
  
  promptBox.value = "";
  addMsg("me", text);

  try {
    // 3. Stream reply
    addMsg("ai", "...", /*stream*/true);
    const aiMsgNode = chatBox.lastChild.querySelector('span');

    let full = "";
    let updateCounter = 0;
    
    const stream = await engine.chat.completions.create({
      model: "Qwen3-1.7B-q4f16_1-MLC", 
      stream: true,
      messages: [...history, {role: "user", content: text}]
    });

    for await (const delta of stream) {
      const piece = delta.choices[0]?.delta?.content || "";
      full += piece;
      updateCounter++;
      
      // Throttle updates for better performance - update every 5 tokens
      if (updateCounter % 5 === 0 || piece.includes('\n')) {
        aiMsgNode.innerHTML = processStreamingFast(full);
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    }

    // Ensure final streaming content is displayed
    aiMsgNode.innerHTML = processStreamingFast(full);
    
    // Final processing after streaming is complete - convert to final format
    aiMsgNode.innerHTML = processAIResponse(full);
    chatBox.scrollTop = chatBox.scrollHeight;

    // 4. Save to history
    history.push({role:"user",content:text});
    history.push({role:"assistant",content:full});
  } catch (err) {
    console.error('Chat completion failed:', err);
    addMsg("ai", "Sorry, I encountered an error. Please try again.");
  }
}

// Reset chat function
async function resetChat() {
  try {
    if (engine && isEngineReady) {
      await engine.resetChat();
    }
    history = [];
    chatBox.innerHTML = '';
    addMsg("ai","**Chat reset!** 🔄\n\nHi 👋 I'm **Qwen3 1.7B** running fully in your browser!\n\nAsk me anything!");
  } catch (err) {
    console.error('Failed to reset chat:', err);
  }
}

// Add reset button to the UI
function addResetButton() {
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset Chat';
  resetBtn.style.cssText = 'margin: 10px; padding: 8px 16px; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer;';
  resetBtn.onclick = resetChat;
  
  // Insert before the form
  form.parentNode.insertBefore(resetBtn, form);
}

// helper to inject DOM
function addMsg(who, text, streaming=false){
  const wrap = document.createElement('div');
  wrap.className = `message ${who}`;
  
  if (who === 'ai' && !streaming) {
    // Process AI messages with markdown and thinking tags
    const span = document.createElement('span');
    span.innerHTML = processAIResponse(text);
    wrap.appendChild(span);
  } else if (who === 'ai' && streaming) {
    // For streaming, just create the span - content will be updated via innerHTML
    wrap.innerHTML = `<span>${text}</span>`;
  } else {
    // For user messages, escape HTML and apply basic markdown
    const userText = renderMarkdown(text);
    wrap.innerHTML = `<span>${userText}</span>`;
  }
  
  chatBox.appendChild(wrap);
  if(!streaming) chatBox.scrollTop = chatBox.scrollHeight;
}
