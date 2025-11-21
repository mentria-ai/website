/**
 * Mentria AI Chat - Main Application
 * Controls the chat UI and interactions with the WebLLM engine
 */

(function() {
    // DOM Elements
    // Using IDs exactly as they appear in chat/index.html
    const modelSelect = document.getElementById('model-select');
    const loadModelBtn = document.getElementById('load-model-btn');
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const modelLoadingOverlay = document.getElementById('model-loading');
    const modelProgressBar = document.getElementById('model-progress-bar');
    const modelLoadingStatus = document.querySelector('.model-loading-status') || document.getElementById('loading-status');
    const modelLoadingDetail = document.getElementById('loading-detail');
    const modelLoadingSize = document.getElementById('model-loading-size');
    const moreOptionsBtn = document.getElementById('moreOptionsBtn');
    const menuPopup = document.getElementById('menuPopup');
    const aboutLink = document.getElementById('aboutLink');
    const shareLink = document.getElementById('shareLink');
    const splashScreen = document.getElementById('splash-screen');
    
    // State variables
    let currentModel = null;
    let isGenerating = false;
    
    // Initialize event listeners
    function initEventListeners() {
        // Load model button
        if (loadModelBtn) {
            loadModelBtn.addEventListener('click', handleLoadModel);
        }
        
        // Send message
        if (sendButton && messageInput) {
            sendButton.addEventListener('click', handleSendMessage);
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                }
            });
        }
        
        // Clear chat
        if (clearChatBtn) {
            clearChatBtn.addEventListener('click', clearChat);
        }
        
        // Menu popup
        if (moreOptionsBtn && menuPopup) {
            moreOptionsBtn.addEventListener('click', toggleMenuPopup);
            document.addEventListener('click', (e) => {
                if (menuPopup && !menuPopup.contains(e.target) && e.target !== moreOptionsBtn) {
                    menuPopup.classList.remove('active');
                }
            });
        }
        
        // About link
        if (aboutLink) {
            aboutLink.addEventListener('click', (e) => {
                e.preventDefault();
                showAboutInfo();
                if (menuPopup) menuPopup.classList.remove('active');
            });
        }
        
        // Share link
        if (shareLink) {
            shareLink.addEventListener('click', (e) => {
                e.preventDefault();
                shareChat();
                if (menuPopup) menuPopup.classList.remove('active');
            });
        }
    }
    
    // Toggle menu popup
    function toggleMenuPopup() {
        if (menuPopup) {
            menuPopup.classList.toggle('active');
        }
    }
    
    // Handle load model button click
    async function handleLoadModel() {
        if (!modelSelect) return;
        
        const selectedModel = modelSelect.value;
        
        if (!selectedModel) {
            alert('Please select a model first');
            return;
        }
        
        // Show loading overlay
        showLoadingOverlay(true);
        if (modelLoadingStatus) modelLoadingStatus.textContent = 'Initializing...';
        if (modelProgressBar) modelProgressBar.style.width = '0%';
        if (modelLoadingDetail) modelLoadingDetail.textContent = 'Preparing to download the model';
        
        try {
            // Hide splash screen if it's still visible
            if (splashScreen) {
                splashScreen.style.display = 'none';
            }
            
            // Initialize the WebLLM engine with callbacks
            const success = await window.webLLMEngine.initialize(selectedModel, {
                onInit: (message) => {
                    if (modelLoadingStatus) modelLoadingStatus.textContent = message;
                },
                onProgress: (report) => {
                    updateLoadingProgress(report);
                },
                onLoad: (message) => {
                    if (modelLoadingStatus) modelLoadingStatus.textContent = message;
                    currentModel = selectedModel;
                    // Update UI to reflect loaded model
                    if (loadModelBtn) {
                        loadModelBtn.textContent = 'Model Loaded';
                        loadModelBtn.classList.add('loaded');
                    }
                    
                    // Add a system message indicating the model is loaded
                    addSystemMessage(`${formatModelName(selectedModel)} is now ready to chat!`);
                    
                    // Hide loading overlay after a short delay
                    setTimeout(() => {
                        showLoadingOverlay(false);
                    }, 1000);
                },
                onError: (errorMessage) => {
                    if (modelLoadingStatus) modelLoadingStatus.textContent = `Error: ${errorMessage}`;
                    showLoadingOverlay(false);
                    alert(`Failed to load model: ${errorMessage}`);
                }
            });
            
            if (!success) {
                throw new Error('Failed to initialize model');
            }
        } catch (error) {
            console.error('Error loading model:', error);
            if (modelLoadingStatus) modelLoadingStatus.textContent = 'Error loading model';
            showLoadingOverlay(false);
            alert(`Error loading model: ${error.message}`);
        }
    }
    
    // Format model name for display
    function formatModelName(modelId) {
        return modelId
            .replace(/[-_]/g, ' ')
            .replace(/q4f\d+_\d+|q4f\d+|q4_k_m/i, '')
            .replace(/instruct/i, 'Instruct')
            .replace(/chat/i, 'Chat')
            .trim();
    }
    
    // Update loading progress
    function updateLoadingProgress(report) {
        // Calculate percentage
        let percent = 0;
        if (report.progress && report.total_size_bytes > 0) {
            percent = (report.progress / report.total_size_bytes) * 100;
        }
        
        // Update progress bar
        if (modelProgressBar) modelProgressBar.style.width = `${percent}%`;
        
        // Update text
        if (modelLoadingDetail && report.status) {
            modelLoadingDetail.textContent = report.status;
        }
        
        // Update status text
        if (modelLoadingStatus) {
            const downloadedMB = (report.progress / (1024 * 1024)).toFixed(1);
            const totalMB = (report.total_size_bytes / (1024 * 1024)).toFixed(1);
            modelLoadingStatus.textContent = `Downloaded: ${downloadedMB} MB / ${totalMB} MB`;
        }
    }
    
    // Show/hide loading overlay
    function showLoadingOverlay(show) {
        if (modelLoadingOverlay) {
            if (show) {
                modelLoadingOverlay.classList.add('active');
            } else {
                modelLoadingOverlay.classList.remove('active');
            }
        }
    }
    
    // Handle send message button click
    async function handleSendMessage() {
        if (!messageInput || !chatMessages) return;
        
        const message = messageInput.value.trim();
        
        if (!message || isGenerating) {
            return;
        }
        
        if (!window.webLLMEngine || !window.webLLMEngine.isLoaded()) {
            alert('Please load a model first');
            return;
        }
        
        // Add user message to chat
        addUserMessage(message);
        
        // Clear input
        messageInput.value = '';
        
        // Create AI message container
        const aiMessageElement = createMessageElement('ai');
        chatMessages.appendChild(aiMessageElement);
        
        // Create typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = '<span></span><span></span><span></span>';
        aiMessageElement.querySelector('.message-content').appendChild(typingIndicator);
        
        // Scroll to bottom
        scrollToBottom();
        
        // Set generating flag
        isGenerating = true;
        
        try {
            // Generate response
            let responseText = '';
            const fullResponse = await window.webLLMEngine.generateResponse(message, (token) => {
                // Remove typing indicator if it's the first token
                if (responseText === '') {
                    const contentElement = aiMessageElement.querySelector('.message-content');
                    contentElement.innerHTML = '';
                }
                
                // Append token
                responseText += token;
                
                // Update message content
                const contentElement = aiMessageElement.querySelector('.message-content');
                contentElement.innerHTML = processMarkdown(responseText);
                
                // Scroll to bottom
                scrollToBottom();
            });
            
            // Ensure any final updates are applied
            const contentElement = aiMessageElement.querySelector('.message-content');
            contentElement.innerHTML = processMarkdown(responseText);
            
        } catch (error) {
            console.error('Error generating response:', error);
            // Show error in message
            const contentElement = aiMessageElement.querySelector('.message-content');
            contentElement.innerHTML = `<span class="error-message">Error generating response: ${error.message}</span>`;
        } finally {
            // Reset generating flag
            isGenerating = false;
            
            // Scroll to bottom
            scrollToBottom();
        }
    }
    
    // Add user message to chat
    function addUserMessage(message) {
        if (!chatMessages) return;
        
        const messageElement = createMessageElement('user');
        messageElement.querySelector('.message-content').textContent = message;
        chatMessages.appendChild(messageElement);
        scrollToBottom();
    }
    
    // Add system message to chat
    function addSystemMessage(message) {
        if (!chatMessages) return;
        
        const messageElement = createMessageElement('system');
        messageElement.querySelector('.message-content').textContent = message;
        chatMessages.appendChild(messageElement);
        scrollToBottom();
    }
    
    // Create message element
    function createMessageElement(type) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${type}-message`;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        messageElement.appendChild(contentElement);
        
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        timeElement.textContent = formatTime(new Date());
        messageElement.appendChild(timeElement);
        
        return messageElement;
    }
    
    // Format time
    function formatTime(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const formattedHours = hours % 12 || 12;
        const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
        return `${formattedHours}:${formattedMinutes} ${ampm}`;
    }
    
    // Process markdown
    function processMarkdown(text) {
        // Handle code blocks
        text = text.replace(/```(\w*)([\s\S]*?)```/g, function(match, language, code) {
            return `<pre class="code-block${language ? ' language-'+language : ''}"><code>${code.trim()}</code></pre>`;
        });
        
        // Handle inline code
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Handle bold text
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // Handle italic text
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // Handle lists
        text = text.replace(/^\s*[\-\*]\s+(.+)$/gm, '<li>$1</li>');
        text = text.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
        
        // Handle line breaks
        text = text.replace(/\n/g, '<br>');
        
        return text;
    }
    
    // Scroll chat to bottom
    function scrollToBottom() {
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
    
    // Clear chat
    function clearChat() {
        if (!chatMessages) return;
        
        // Remove all messages except the welcome message
        while (chatMessages.children.length > 1) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        
        // Reset the WebLLM conversation
        if (window.webLLMEngine && window.webLLMEngine.resetConversation) {
            window.webLLMEngine.resetConversation();
        }
    }
    
    // Show about information
    function showAboutInfo() {
        alert('Mentria AI Chat\nPowered by WebLLM\nRun AI models directly in your browser!');
    }
    
    // Share chat functionality
    function shareChat() {
        navigator.share({
            title: 'Mentria AI Chat',
            text: 'Check out this browser-based AI chat application!',
            url: window.location.href
        }).catch((error) => console.log('Error sharing:', error));
    }
    
    // Initialize the application
    function init() {
        console.log("Initializing chat application...");
        
        // Check if required elements exist and log their status for debugging
        const requiredElements = {
            'modelSelect': modelSelect,
            'loadModelBtn': loadModelBtn,
            'chatMessages': chatMessages,
            'messageInput': messageInput,
            'sendButton': sendButton,
        };
        
        const missingElements = Object.entries(requiredElements)
            .filter(([_, element]) => !element)
            .map(([name]) => name);
            
        if (missingElements.length > 0) {
            console.warn(`Missing required elements: ${missingElements.join(', ')}`);
            console.warn("Chat functionality may be limited. Check element IDs in HTML.");
        }
        
        // Hide splash screen after a delay
        setTimeout(() => {
            if (splashScreen) {
                splashScreen.style.display = 'none';
            }
        }, 1500);
        
        // Initialize event listeners (safely handling null elements)
        initEventListeners();
    }
    
    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', init);
})(); 