/**
 * Chat UI - Handles the user interface for chatting with WebLLM about facts
 */

class ChatUI {
    constructor() {
        this.initialized = false;
        this.isModelLoaded = false;
        this.activeChat = false;
        this.elements = {
            container: null,
            toggleButton: null,
            chatWindow: null,
            messagesList: null,
            inputForm: null,
            textInput: null,
            loadingIndicator: null,
            progressBar: null,
            progressText: null
        };
        
        // Initialize when DOM is loaded
        if (document.readyState === 'complete') {
            this.init();
        } else {
            window.addEventListener('DOMContentLoaded', () => this.init());
        }
    }
    
    /**
     * Initialize the chat UI
     */
    init() {
        if (this.initialized) return;
        
        // Create chat UI elements
        this.createChatUI();
        
        // Set up event listeners
        this.setupEventListeners();
        
        this.initialized = true;
        
        // Load WebLLM in background
        this.loadModel();
    }
    
    /**
     * Create the chat UI elements
     */
    createChatUI() {
        // Create chat toggle button
        const toggleButton = document.createElement('button');
        toggleButton.id = 'chat-toggle';
        toggleButton.className = 'chat-toggle-button';
        toggleButton.innerHTML = '<span class="material-symbols-rounded">chat</span>';
        toggleButton.title = 'Chat about this fact';
        
        // Create chat container
        const chatContainer = document.createElement('div');
        chatContainer.id = 'chat-container';
        chatContainer.className = 'chat-container hidden';
        
        // Create chat header
        const chatHeader = document.createElement('div');
        chatHeader.className = 'chat-header';
        chatHeader.innerHTML = `
            <h3>Chat about this fact</h3>
            <button class="chat-close-button">
                <span class="material-symbols-rounded">close</span>
            </button>
        `;
        
        // Create messages container
        const messagesContainer = document.createElement('div');
        messagesContainer.className = 'chat-messages';
        messagesContainer.id = 'chat-messages';
        
        // Create loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'chat-loading';
        loadingIndicator.innerHTML = `
            <div class="loading-progress">
                <div class="progress-bar-container">
                    <div class="progress-bar" id="chat-progress-bar"></div>
                </div>
                <div class="progress-text" id="chat-progress-text">Loading model...</div>
            </div>
        `;
        
        // Create input form
        const inputForm = document.createElement('form');
        inputForm.className = 'chat-input-form';
        inputForm.id = 'chat-form';
        inputForm.innerHTML = `
            <input type="text" id="chat-input" placeholder="Ask about this fact..." disabled>
            <button type="submit" id="chat-submit" disabled>
                <span class="material-symbols-rounded">send</span>
            </button>
        `;
        
        // Append all elements
        chatContainer.appendChild(chatHeader);
        chatContainer.appendChild(messagesContainer);
        chatContainer.appendChild(loadingIndicator);
        chatContainer.appendChild(inputForm);
        
        // Add to document
        document.body.appendChild(toggleButton);
        document.body.appendChild(chatContainer);
        
        // Store references
        this.elements = {
            container: chatContainer,
            toggleButton: toggleButton,
            chatWindow: chatContainer,
            messagesList: messagesContainer,
            inputForm: inputForm,
            textInput: inputForm.querySelector('#chat-input'),
            loadingIndicator: loadingIndicator,
            progressBar: loadingIndicator.querySelector('#chat-progress-bar'),
            progressText: loadingIndicator.querySelector('#chat-progress-text'),
            closeButton: chatHeader.querySelector('.chat-close-button')
        };
    }
    
    /**
     * Set up event listeners for the chat UI
     */
    setupEventListeners() {
        // Toggle chat visibility
        this.elements.toggleButton.addEventListener('click', () => this.toggleChat());
        
        // Close chat
        this.elements.closeButton.addEventListener('click', () => this.toggleChat(false));
        
        // Form submission
        this.elements.inputForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleUserMessage();
        });
        
        // Listen for quote changes to update context
        document.addEventListener('quoteChanged', (e) => {
            if (this.activeChat && this.isModelLoaded) {
                this.updateChatContext(e.detail.quote);
            }
        });
    }
    
    /**
     * Toggle chat visibility
     * @param {boolean} [show] - Force show/hide
     */
    toggleChat(show = null) {
        const isCurrentlyVisible = !this.elements.container.classList.contains('hidden');
        const shouldShow = show !== null ? show : !isCurrentlyVisible;
        
        if (shouldShow) {
            this.elements.container.classList.remove('hidden');
            this.activeChat = true;
            
            // If model is loaded but we have no messages, add the welcome message
            if (this.isModelLoaded && this.elements.messagesList.children.length === 0) {
                this.addSystemMessage("Hi! I can help explain this fact or answer questions about it. What would you like to know?");
            }
            
            // Focus input
            setTimeout(() => this.elements.textInput.focus(), 300);
        } else {
            this.elements.container.classList.add('hidden');
            this.activeChat = false;
        }
    }
    
    /**
     * Load the WebLLM model
     */
    async loadModel() {
        try {
            this.elements.progressText.textContent = "Loading model...";
            this.showLoading(true);
            
            // Initialize WebLLM
            await webLLMEngine.init((progress) => {
                // Update progress
                this.elements.progressBar.style.width = `${progress.percent * 100}%`;
                this.elements.progressText.textContent = progress.text;
            });
            
            // Model loaded successfully
            this.isModelLoaded = true;
            this.elements.textInput.disabled = false;
            this.elements.textInput.placeholder = "Ask about this fact...";
            this.elements.inputForm.querySelector('button').disabled = false;
            
            // Hide loading indicator
            this.showLoading(false);
            
            // If chat is active, show welcome message
            if (this.activeChat && this.elements.messagesList.children.length === 0) {
                this.addSystemMessage("Hi! I can help explain this fact or answer questions about it. What would you like to know?");
            }
            
        } catch (error) {
            console.error("Failed to load model:", error);
            this.elements.progressText.textContent = "Failed to load model. Please refresh.";
            this.elements.progressBar.style.width = "100%";
            this.elements.progressBar.style.backgroundColor = "#ff4d4d";
        }
    }
    
    /**
     * Show or hide loading indicator
     * @param {boolean} show - Whether to show or hide
     */
    showLoading(show) {
        this.elements.loadingIndicator.style.display = show ? 'flex' : 'none';
    }
    
    /**
     * Handle user message submission
     */
    async handleUserMessage() {
        const messageText = this.elements.textInput.value.trim();
        
        if (!messageText || !this.isModelLoaded) return;
        
        // Add user message to chat
        this.addUserMessage(messageText);
        
        // Clear input
        this.elements.textInput.value = '';
        
        // Get current fact as context
        const factContext = this.getCurrentFactContext();
        const systemPrompt = this.createSystemPrompt(factContext);
        
        try {
            // Create placeholder for assistant response
            const responseId = this.addAssistantMessagePlaceholder();
            
            // Generate response
            const response = await webLLMEngine.generateResponse(
                messageText,
                systemPrompt,
                (partialResponse) => {
                    // Update the placeholder with the partial response
                    this.updateAssistantMessage(responseId, partialResponse);
                }
            );
            
            // Ensure the final response is displayed
            this.updateAssistantMessage(responseId, response);
            
        } catch (error) {
            console.error("Error generating response:", error);
            this.addSystemMessage("Sorry, I couldn't generate a response. Please try again.");
        }
    }
    
    /**
     * Add a user message to the chat
     * @param {string} message - The message text
     */
    addUserMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message user-message';
        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHTML(message)}</div>
        `;
        
        this.elements.messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }
    
    /**
     * Add an assistant message to the chat
     * @param {string} message - The message text
     * @returns {string} - Message ID
     */
    addAssistantMessagePlaceholder() {
        const messageId = 'msg-' + Date.now();
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message assistant-message';
        messageElement.id = messageId;
        messageElement.innerHTML = `
            <div class="message-content"><span class="message-typing">...</span></div>
        `;
        
        this.elements.messagesList.appendChild(messageElement);
        this.scrollToBottom();
        
        return messageId;
    }
    
    /**
     * Update an assistant message with new content
     * @param {string} messageId - ID of the message to update
     * @param {string} content - New content
     */
    updateAssistantMessage(messageId, content) {
        const messageElement = document.getElementById(messageId);
        if (messageElement) {
            const contentElement = messageElement.querySelector('.message-content');
            contentElement.innerHTML = this.escapeHTML(content);
            this.scrollToBottom();
        }
    }
    
    /**
     * Add a system message to the chat
     * @param {string} message - The message text
     */
    addSystemMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message system-message';
        messageElement.innerHTML = `
            <div class="message-content">${this.escapeHTML(message)}</div>
        `;
        
        this.elements.messagesList.appendChild(messageElement);
        this.scrollToBottom();
    }
    
    /**
     * Scroll the chat messages to the bottom
     */
    scrollToBottom() {
        this.elements.messagesList.scrollTop = this.elements.messagesList.scrollHeight;
    }
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Raw text
     * @returns {string} - Escaped HTML
     */
    escapeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Get the current fact context
     * @returns {string} - Current fact
     */
    getCurrentFactContext() {
        try {
            // Get the active quote element
            const activeSlide = document.querySelector('.quote.active');
            
            if (!activeSlide) {
                return "No fact currently displayed.";
            }
            
            // Get the quote text
            const quoteTextElement = activeSlide.querySelector('.animated-text');
            
            if (!quoteTextElement) {
                return "No fact text found.";
            }
            
            // Return the quote text
            return quoteTextElement.textContent.trim();
        } catch (error) {
            console.error("Error getting current fact context:", error);
            return "Error retrieving current fact.";
        }
    }
    
    /**
     * Create system prompt for the model with current fact context
     * @param {string} factContext - Current fact text
     * @returns {string} - System prompt
     */
    createSystemPrompt(factContext) {
        return `You are a helpful assistant that provides information about interesting facts. 
                     
Current fact: ${factContext}

Your job is to explain aspects of this fact, answer questions about it, provide additional context when asked, 
and help the user understand it better. Stick to information relevant to the current fact.

- Keep your responses concise and focused.
- If you don't know something, admit it rather than making up information.
- Avoid political opinions or controversial takes.
- Be friendly and engaging.`;
    }
    
    /**
     * Update the chat context when the fact changes
     * @param {string} newFact - New fact text
     */
    updateChatContext(newFact) {
        if (this.activeChat && this.isModelLoaded) {
            this.addSystemMessage("New fact loaded. You can now ask questions about this fact.");
        }
    }
}

// Initialize the chat UI
const chatUI = new ChatUI(); 