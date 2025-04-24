/**
 * LLM UI Component
 * 
 * This file provides the user interface for interacting with WebLLM models.
 * It handles the display of model selection, chat interface, and integration
 * with the WebLLM engine.
 */

class LLMUI {
    constructor() {
        this.engine = new WebLLMEngine();
        this.isUIInitialized = false;
        this.chatHistory = [];
        this.isProcessing = false;
        this.selectedModelId = null;
        
        // DOM elements
        this.chatContainer = null;
        this.modelSelector = null;
        this.chatInput = null;
        this.sendButton = null;
        this.progressBar = null;
        this.progressText = null;
        this.modelInfoPanel = null;
        this.chatMessages = null;
        this.toggleUIButton = null;
    }

    /**
     * Initialize the LLM UI components
     */
    initialize() {
        if (this.isUIInitialized) return;
        
        this._createUIElements();
        this._setupEventListeners();
        this._populateModelSelector();
        
        this.engine.setDebug(true);
        this.engine.setProgressCallback(this._updateProgress.bind(this));
        
        this.isUIInitialized = true;
    }

    /**
     * Create all UI elements for the LLM interface
     * @private
     */
    _createUIElements() {
        // Create main container
        const container = document.createElement('div');
        container.id = 'llm-ui-container';
        container.className = 'llm-ui';
        
        // Create toggle button for showing/hiding the UI
        this.toggleUIButton = document.createElement('button');
        this.toggleUIButton.id = 'llm-toggle-button';
        this.toggleUIButton.className = 'llm-toggle-button';
        this.toggleUIButton.innerHTML = '<i class="fas fa-robot"></i>';
        document.body.appendChild(this.toggleUIButton);
        
        // Create model selection area
        const modelArea = document.createElement('div');
        modelArea.className = 'llm-model-area';
        
        this.modelSelector = document.createElement('select');
        this.modelSelector.id = 'llm-model-selector';
        
        this.modelInfoPanel = document.createElement('div');
        this.modelInfoPanel.className = 'llm-model-info';
        
        this.progressBar = document.createElement('div');
        this.progressBar.className = 'llm-progress-bar';
        this.progressBar.innerHTML = '<div class="llm-progress-fill"></div>';
        
        this.progressText = document.createElement('div');
        this.progressText.className = 'llm-progress-text';
        this.progressText.textContent = 'Select a model to begin';
        
        modelArea.appendChild(this.modelSelector);
        modelArea.appendChild(this.modelInfoPanel);
        modelArea.appendChild(this.progressBar);
        modelArea.appendChild(this.progressText);
        
        // Create chat area
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = 'llm-chat-container';
        
        this.chatMessages = document.createElement('div');
        this.chatMessages.className = 'llm-chat-messages';
        
        const inputArea = document.createElement('div');
        inputArea.className = 'llm-input-area';
        
        this.chatInput = document.createElement('textarea');
        this.chatInput.className = 'llm-chat-input';
        this.chatInput.placeholder = 'Ask me anything...';
        
        this.sendButton = document.createElement('button');
        this.sendButton.className = 'llm-send-button';
        this.sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
        this.sendButton.disabled = true;
        
        inputArea.appendChild(this.chatInput);
        inputArea.appendChild(this.sendButton);
        
        this.chatContainer.appendChild(this.chatMessages);
        this.chatContainer.appendChild(inputArea);
        
        // Assemble UI
        container.appendChild(modelArea);
        container.appendChild(this.chatContainer);
        
        // Add to document
        document.body.appendChild(container);
        
        // Add file upload element for local models
        const fileUploadArea = document.createElement('div');
        fileUploadArea.className = 'llm-file-upload';
        
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'llm-model-upload';
        fileInput.multiple = true;
        fileInput.accept = '.bin,.wasm,.json';
        
        const fileLabel = document.createElement('label');
        fileLabel.htmlFor = 'llm-model-upload';
        fileLabel.textContent = 'Upload local model files';
        
        fileUploadArea.appendChild(fileInput);
        fileUploadArea.appendChild(fileLabel);
        
        modelArea.appendChild(fileUploadArea);
    }

    /**
     * Set up event listeners for UI components
     * @private
     */
    _setupEventListeners() {
        // Model selection change
        this.modelSelector.addEventListener('change', (e) => {
            const modelId = e.target.value;
            if (!modelId) return;
            
            this.selectedModelId = modelId;
            this._updateModelInfo(modelId);
            this._loadSelectedModel();
        });
        
        // Send button click
        this.sendButton.addEventListener('click', () => {
            this._sendMessage();
        });
        
        // Input keypress (Enter to send)
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendMessage();
            }
        });
        
        // Toggle UI visibility
        this.toggleUIButton.addEventListener('click', () => {
            const container = document.getElementById('llm-ui-container');
            container.classList.toggle('llm-ui-visible');
        });
        
        // File upload for local models
        document.getElementById('llm-model-upload').addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length === 0) return;
            
            this._handleLocalModelFiles(files);
        });
    }

    /**
     * Populate the model selector with available models
     * @private
     */
    _populateModelSelector() {
        // Add default empty option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Select a model --';
        this.modelSelector.appendChild(defaultOption);
        
        // Add models from the engine's model list
        Object.entries(this.engine.getModelList()).forEach(([id, model]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = model.name || id;
            this.modelSelector.appendChild(option);
        });
        
        // Add option for local model
        const localOption = document.createElement('option');
        localOption.value = 'local-model';
        localOption.textContent = 'Load local model';
        this.modelSelector.appendChild(localOption);
    }

    /**
     * Update the model info panel with details about the selected model
     * @private
     * @param {string} modelId - The ID of the selected model
     */
    _updateModelInfo(modelId) {
        if (modelId === 'local-model') {
            this.modelInfoPanel.innerHTML = `
                <h3>Local Model</h3>
                <p>Upload model files from your device</p>
                <p>Required files: model binary (.bin), WASM file, and model config (.json)</p>
            `;
            document.querySelector('.llm-file-upload').style.display = 'block';
            return;
        }
        
        document.querySelector('.llm-file-upload').style.display = 'none';
        
        const model = this.engine.getModelInfo(modelId);
        if (!model) {
            this.modelInfoPanel.innerHTML = '<p>Model information not available</p>';
            return;
        }
        
        this.modelInfoPanel.innerHTML = `
            <h3>${model.name || modelId}</h3>
            <p>${model.description || 'No description available'}</p>
            <p>Size: ${model.size || 'Unknown'}</p>
        `;
    }

    /**
     * Load the selected model using the WebLLM engine
     * @private
     */
    _loadSelectedModel() {
        if (!this.selectedModelId) return;
        
        this.isProcessing = true;
        this.sendButton.disabled = true;
        this._updateProgress(0, 'Initializing...');
        
        // Reset chat history when changing models
        this.chatHistory = [];
        this.chatMessages.innerHTML = '';
        
        // Add welcome message
        this._addSystemMessage('Loading model, please wait...');
        
        // If model is already loaded, no need to reload
        if (this.engine.isModelLoaded() && this.engine.getCurrentModelId() === this.selectedModelId) {
            this._modelLoadComplete();
            return;
        }
        
        // Load the model
        if (this.selectedModelId === 'local-model') {
            // Local model requires files to be uploaded first
            document.querySelector('.llm-file-upload').style.display = 'block';
        } else {
            // Load remote model
            this.engine.loadModel(this.selectedModelId)
                .then(() => {
                    this._modelLoadComplete();
                })
                .catch(error => {
                    this._updateProgress(0, 'Error loading model');
                    this._addSystemMessage(`Failed to load model: ${error.message}`);
                    console.error('Error loading model:', error);
                    this.isProcessing = false;
                });
        }
    }

    /**
     * Handle the local model files upload
     * @private
     * @param {FileList} files - The uploaded files
     */
    _handleLocalModelFiles(files) {
        if (files.length === 0) return;
        
        this.isProcessing = true;
        this.sendButton.disabled = true;
        this._updateProgress(0, 'Processing uploaded files...');
        
        // Reset chat
        this.chatHistory = [];
        this.chatMessages.innerHTML = '';
        this._addSystemMessage('Loading local model from files, please wait...');
        
        // Process files and initiate local model loading
        this.engine.initFromLocalFiles(files)
            .then(() => {
                this._modelLoadComplete();
            })
            .catch(error => {
                this._updateProgress(0, 'Error loading local model');
                this._addSystemMessage(`Failed to load local model: ${error.message}`);
                console.error('Error loading local model:', error);
                this.isProcessing = false;
            });
    }

    /**
     * Called when model loading is complete
     * @private
     */
    _modelLoadComplete() {
        this._updateProgress(100, 'Model loaded successfully');
        this.chatMessages.innerHTML = '';
        this._addSystemMessage('Model loaded successfully! You can now start chatting.');
        this.isProcessing = false;
        this.sendButton.disabled = false;
    }

    /**
     * Send a message to the model and display the response
     * @private
     */
    _sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message || this.isProcessing) return;
        
        if (!this.engine.isModelLoaded()) {
            this._addSystemMessage('Please select and load a model first');
            return;
        }
        
        // Disable input during processing
        this.isProcessing = true;
        this.sendButton.disabled = true;
        this.chatInput.value = '';
        
        // Add user message to chat
        this._addUserMessage(message);
        
        // Prepare response container
        const responseId = 'response-' + Date.now();
        this._addResponsePlaceholder(responseId);
        
        // Send to engine
        this.engine.generateResponse(message, this.chatHistory)
            .then(response => {
                // Update placeholder with actual response
                this._updateResponseMessage(responseId, response);
                
                // Add to chat history
                this.chatHistory.push({
                    role: 'user',
                    content: message
                });
                this.chatHistory.push({
                    role: 'assistant',
                    content: response
                });
                
                // Re-enable input
                this.isProcessing = false;
                this.sendButton.disabled = false;
                this.chatInput.focus();
            })
            .catch(error => {
                console.error('Error generating response:', error);
                this._updateResponseMessage(responseId, `Error: ${error.message}`);
                this.isProcessing = false;
                this.sendButton.disabled = false;
            });
    }

    /**
     * Add a user message to the chat display
     * @private
     * @param {string} message - The user's message
     */
    _addUserMessage(message) {
        const msgElement = document.createElement('div');
        msgElement.className = 'llm-message llm-user-message';
        msgElement.innerHTML = `
            <div class="llm-message-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="llm-message-content">${this._formatMessage(message)}</div>
        `;
        this.chatMessages.appendChild(msgElement);
        this._scrollToBottom();
    }

    /**
     * Add a response placeholder to the chat display
     * @private
     * @param {string} id - Unique ID for the response element
     */
    _addResponsePlaceholder(id) {
        const msgElement = document.createElement('div');
        msgElement.className = 'llm-message llm-assistant-message';
        msgElement.innerHTML = `
            <div class="llm-message-avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div id="${id}" class="llm-message-content">
                <div class="llm-typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        this.chatMessages.appendChild(msgElement);
        this._scrollToBottom();
    }

    /**
     * Update a response placeholder with the actual message
     * @private
     * @param {string} id - The ID of the response element
     * @param {string} message - The response message
     */
    _updateResponseMessage(id, message) {
        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = this._formatMessage(message);
            this._scrollToBottom();
        }
    }

    /**
     * Add a system message to the chat display
     * @private
     * @param {string} message - The system message
     */
    _addSystemMessage(message) {
        const msgElement = document.createElement('div');
        msgElement.className = 'llm-message llm-system-message';
        msgElement.innerHTML = `
            <div class="llm-message-avatar">
                <i class="fas fa-info-circle"></i>
            </div>
            <div class="llm-message-content">${message}</div>
        `;
        this.chatMessages.appendChild(msgElement);
        this._scrollToBottom();
    }

    /**
     * Format a message for display, converting markdown-like syntax
     * @private
     * @param {string} message - The message to format
     * @returns {string} Formatted HTML
     */
    _formatMessage(message) {
        if (!message) return '';
        
        // Convert newlines to <br>
        let formatted = message.replace(/\n/g, '<br>');
        
        // Convert ** to bold
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Convert * or _ to italic
        formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/_(.*?)_/g, '<em>$1</em>');
        
        // Convert ` to code
        formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
        
        return formatted;
    }

    /**
     * Scroll the chat container to the bottom
     * @private
     */
    _scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    /**
     * Update the progress bar and text
     * @private
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} message - Progress message
     */
    _updateProgress(percent, message) {
        const fill = this.progressBar.querySelector('.llm-progress-fill');
        fill.style.width = `${percent}%`;
        this.progressText.textContent = message || `${Math.round(percent)}%`;
    }
}

// Initialize LLM UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Check if WebLLM engine is available
    if (typeof WebLLMEngine === 'undefined') {
        console.error('WebLLMEngine not found. Make sure webllm-engine.js is loaded first.');
        return;
    }
    
    // Create and initialize UI
    window.llmUI = new LLMUI();
    window.llmUI.initialize();
}); 