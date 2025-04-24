// Main JavaScript file
document.addEventListener('DOMContentLoaded', function() {
    console.log('Instagram Reel UI loaded and ready!');
    
    // Elements
    let mediaContainer = document.querySelector('.media-container');
    let mediaContent = document.querySelector('.media-content');
    const likeBtn = document.getElementById('likeBtn');
    const progressFill = document.getElementById('progressFill');
    const loadingIndicator = document.querySelector('.loading-indicator');
    const bottomControlsContainer = document.querySelector('.bottom-controls-container');
    
    // Current quote tracking
    let currentQuoteId = null;
    
    // Listen for quote changes to update like button state
    document.addEventListener('quoteChanged', function(e) {
        currentQuoteId = e.detail.id;
        updateLikeButtonState(e.detail.liked || false);
    });
    
    // Show loading indicator if it exists
    if (loadingIndicator) {
        loadingIndicator.style.display = 'block';
        
        // Simulate content loading
        setTimeout(() => {
            // Hide loading indicator when content is loaded
            loadingIndicator.style.display = 'none';
            if (mediaContainer) {
                mediaContainer.classList.add('loaded');
            }
            
            // Initialize progress bar to empty state
            if (progressFill) {
                progressFill.style.transform = 'scaleX(0)';
                progressFill.style.transition = 'none';
            }
        }, 1000);
    }
    
    // Update like button state based on saved preferences
    function updateLikeButtonState(isLiked) {
        if (!likeBtn) return;
        
        const heartIcon = likeBtn.querySelector('i');
        if (!heartIcon) return;
        
        if (isLiked) {
            // Show as liked
            heartIcon.classList.remove('far');
            heartIcon.classList.add('fas', 'liked');
        } else {
            // Show as not liked
            heartIcon.classList.remove('fas', 'liked');
            heartIcon.classList.add('far');
        }
    }
    
    // Save liked state to localStorage
    function saveLikedState(quoteId, isLiked) {
        try {
            if (!quoteId) return;
            
            // Load existing liked quotes
            let likedQuotes = JSON.parse(localStorage.getItem('likedQuotes') || '[]');
            
            if (isLiked) {
                // Add to liked quotes if not already present
                if (!likedQuotes.includes(quoteId)) {
                    likedQuotes.push(quoteId);
                }
            } else {
                // Remove from liked quotes
                likedQuotes = likedQuotes.filter(id => id !== quoteId);
            }
            
            // Save back to localStorage
            localStorage.setItem('likedQuotes', JSON.stringify(likedQuotes));
            console.log(`Quote ${quoteId} ${isLiked ? 'liked' : 'unliked'}`);
        } catch (error) {
            console.error('Error saving liked state:', error);
        }
    }
    
    // Double-click to like
    let lastClickTime = 0;
    mediaContainer.addEventListener('click', function(e) {
        // Ignore clicks on control elements
        if (e.target.closest('.reel-controls')) {
            return;
        }
        
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastClickTime;
        
        if (timeDiff < 300) {
            // Double click detected
            likeMedia(true); // Force like on double-click
            
            // Create and animate heart icon
            const heart = document.createElement('i');
            heart.classList.add('fas', 'fa-heart');
            heart.style.position = 'absolute';
            heart.style.top = '50%';
            heart.style.left = '50%';
            heart.style.transform = 'translate(-50%, -50%)';
            heart.style.color = '#fff';
            heart.style.fontSize = '80px';
            heart.style.opacity = '0';
            heart.style.zIndex = '100';
            heart.style.pointerEvents = 'none';
            
            mediaContainer.appendChild(heart);
            
            // Animate the heart
            setTimeout(() => {
                heart.style.opacity = '1';
                heart.style.transition = 'all 0.3s ease';
                heart.style.transform = 'translate(-50%, -50%) scale(1.2)';
            }, 10);
            
            setTimeout(() => {
                heart.style.opacity = '0';
                heart.style.transform = 'translate(-50%, -50%) scale(0.8)';
            }, 1000);
            
            setTimeout(() => {
                mediaContainer.removeChild(heart);
            }, 1500);
        }
        
        lastClickTime = currentTime;
    });
    
    // Like button functionality
    likeBtn.addEventListener('click', () => likeMedia());
    
    function likeMedia(forceLike = false) {
        if (!likeBtn || !currentQuoteId) return;
        
        const heartIcon = likeBtn.querySelector('i');
        if (!heartIcon) return;
        
        const currentlyLiked = heartIcon.classList.contains('fas');
        const newLikedState = forceLike ? true : !currentlyLiked;
        
        // Update UI
        updateLikeButtonState(newLikedState);
        
        // Save state
        saveLikedState(currentQuoteId, newLikedState);
    }
    
    // Handle window resize to maintain aspect ratio
    window.addEventListener('resize', adjustMediaContainer);
    
    function adjustMediaContainer() {
        if (window.innerWidth >= 769) {
            // On desktop, maintain 9:16 aspect ratio
            const maxHeight = window.innerHeight;
            const width = maxHeight * 9/16;
            
            if (width <= window.innerWidth) {
                mediaContainer.style.height = maxHeight + 'px';
                mediaContainer.style.width = width + 'px';
            } else {
                const height = window.innerWidth * 16/9;
                mediaContainer.style.width = window.innerWidth + 'px';
                mediaContainer.style.height = height + 'px';
            }
        } else {
            // On mobile, full screen
            mediaContainer.style.width = '100%';
            mediaContainer.style.height = '100%';
        }
    }
    
    // Initial container adjustment
    adjustMediaContainer();

    // Swipe handling
    let startY = 0;
    let startX = 0;
    let isDragging = false;
    let currentTranslateY = 0;
    const swipeThreshold = 50; // Reduced from 100 for increased sensitivity
    const swipeThresholdX = 30; // Horizontal threshold to prevent accidental swipes
    let currentMedia = document.querySelector('.media-content');

    // Add transition classes for directional animations
    const addTransitionClass = (direction) => {
        if (!mediaContainer) return;
        
        // Remove any existing transition classes
        mediaContainer.classList.remove('transition-up', 'transition-down');
        
        // Add new transition class based on direction
        if (direction === 'next') {
            mediaContainer.classList.add('transition-up');
        } else if (direction === 'prev') {
            mediaContainer.classList.add('transition-down');
        }
        
        // Mark as active for zoom effect
        mediaContainer.classList.add('active');
    };

    // Handle touch/mouse start
    const handleStart = (e) => {
        const touchY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const touchX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        startY = touchY;
        startX = touchX;
        isDragging = true;
        currentTranslateY = 0;
        
        if (mediaContainer) {
            mediaContainer.style.transition = 'none';
        }
        
        // Start showing visual feedback of the drag immediately
        document.addEventListener(e.type.includes('mouse') ? 'mousemove' : 'touchmove', handleMove, { passive: false });
    };

    // Handle touch/mouse move
    const handleMove = (e) => {
        if (!isDragging) return;
        
        // Prevent default to stop scrolling
        e.preventDefault();
        
        const currentY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const diffY = currentY - startY;
        const diffX = Math.abs(currentX - startX);
        
        // If horizontal movement is greater than vertical, it's likely a horizontal swipe
        if (diffX > Math.abs(diffY) && diffX > swipeThresholdX) {
            // Handle as horizontal swipe if needed
            return;
        }
        
        // Apply live translation to show the drag
        currentTranslateY = diffY;
        if (mediaContainer) {
            mediaContainer.style.transform = `translateY(${currentTranslateY * 0.3}px)`; // Reduce movement amount for smoother feel
        }
        
        // Start showing the next/prev image based on drag direction
        if (Math.abs(diffY) > swipeThreshold / 2) {
            if (diffY > 0) {
                // Dragging down - show preview of previous
                addTransitionClass('prev');
            } else {
                // Dragging up - show preview of next
                addTransitionClass('next');
            }
        }
    };

    // Handle touch/mouse end
    const handleEnd = (e) => {
        if (!isDragging) return;
        
        isDragging = false;
        const currentY = e.type.includes('mouse') ? e.clientY : (e.changedTouches ? e.changedTouches[0].clientY : startY);
        const diffY = currentY - startY;
        
        // Reset transform
        if (mediaContainer) {
            mediaContainer.style.transition = 'transform 0.3s ease-out';
            mediaContainer.style.transform = '';
        }
        
        // Check if swipe distance meets threshold
        if (Math.abs(diffY) > swipeThreshold) {
            if (diffY > 0) {
                // Swiped down - go to previous
                if (window.quoteNavigation && typeof window.quoteNavigation.prev === 'function') {
                    window.quoteNavigation.prev();
                }
            } else {
                // Swiped up - go to next
                if (window.quoteNavigation && typeof window.quoteNavigation.next === 'function') {
                    window.quoteNavigation.next();
                }
            }
        }
        
        document.removeEventListener(e.type.includes('mouse') ? 'mousemove' : 'touchmove', handleMove);
    };

    // Add touch and mouse event listeners
    const addSwipeListeners = () => {
        mediaContainer = document.querySelector('.media-container');
        currentMedia = document.querySelector('.media-content');
        
        if (!mediaContainer) return;
        
        // Touch events
        mediaContainer.addEventListener('touchstart', handleStart, { passive: true });
        mediaContainer.addEventListener('touchend', handleEnd);
        
        // Mouse events for desktop
        mediaContainer.addEventListener('mousedown', handleStart);
        document.addEventListener('mouseup', handleEnd);
    };

    // Remove old event listeners before adding new ones after quote change
    document.addEventListener('quoteChanged', () => {
        // Update references
        mediaContainer = document.querySelector('.media-container');
        currentMedia = document.querySelector('.media-content');
    });

    // Initialize swipe detection
    document.addEventListener('DOMContentLoaded', () => {
        addSwipeListeners();
        
        // Add keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (window.quoteNavigation) {
                if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    window.quoteNavigation.prev();
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    window.quoteNavigation.next();
                }
            }
        });
    });

    // Initialize chat functionality
    initializeChatUI();
});

// Initialize chat functionality
function initializeChatUI() {
    const chatButton = document.getElementById('chat-button');
    const chatModal = document.getElementById('chat-modal');
    const closeChat = document.getElementById('close-chat');
    const loadModelButton = document.getElementById('load-model-button');
    const modelSelector = document.getElementById('model-selector');
    const modelLoading = document.getElementById('model-loading');
    const loadingMessage = document.getElementById('loading-message');
    const loadingProgress = document.getElementById('loading-progress');
    const chatInput = document.getElementById('chat-input');
    const sendMessageButton = document.getElementById('send-message');
    const chatMessages = document.getElementById('chat-messages');
    
    let modelLoaded = false;
    
    // Open chat modal
    chatButton.addEventListener('click', () => {
        chatModal.classList.remove('hidden');
    });
    
    // Close chat modal
    closeChat.addEventListener('click', () => {
        chatModal.classList.add('hidden');
    });
    
    // Load selected model
    loadModelButton.addEventListener('click', async () => {
        if (modelLoaded) {
            addSystemMessage('Model already loaded and ready to use!');
            return;
        }
        
        const selectedModel = modelSelector.value;
        
        if (!selectedModel) {
            addSystemMessage('Please select a model first.', true);
            return;
        }
        
        try {
            // Disable inputs during loading
            modelSelector.disabled = true;
            loadModelButton.disabled = true;
            modelLoading.classList.remove('hidden');
            
            // Initialize WebLLM
            const success = await webLLMEngine.initialize(selectedModel, {
                onInit: (msg) => {
                    loadingMessage.textContent = msg;
                    loadingProgress.textContent = '0%';
                },
                onProgress: (progress) => {
                    if (progress.progress) {
                        const percent = Math.round(progress.progress * 100);
                        loadingProgress.textContent = `${percent}%`;
                        
                        if (progress.text) {
                            loadingMessage.textContent = progress.text;
                        }
                    }
                },
                onLoad: (msg) => {
                    modelLoaded = true;
                    loadingMessage.textContent = msg;
                    loadingProgress.textContent = '100%';
                    
                    // Enable chat after model load
                    chatInput.disabled = false;
                    sendMessageButton.disabled = false;
                    
                    // Add system message
                    addSystemMessage('Model loaded successfully! You can now chat about the current fact.');
                    
                    // Hide loading indicator after a delay
                    setTimeout(() => {
                        modelLoading.classList.add('hidden');
                    }, 1500);
                },
                onError: (errMsg) => {
                    addSystemMessage(`Error loading model: ${errMsg}`, true);
                    
                    // Re-enable inputs
                    modelSelector.disabled = false;
                    loadModelButton.disabled = false;
                    modelLoading.classList.add('hidden');
                }
            });
            
            if (!success) {
                modelSelector.disabled = false;
                loadModelButton.disabled = false;
            }
        } catch (error) {
            console.error('Error initializing model:', error);
            addSystemMessage(`Error: ${error.message || 'Unknown error'}`, true);
            
            // Re-enable inputs
            modelSelector.disabled = false;
            loadModelButton.disabled = false;
            modelLoading.classList.add('hidden');
        }
    });
    
    // Send message
    function sendMessage() {
        const message = chatInput.value.trim();
        
        if (!message) return;
        
        if (!modelLoaded) {
            addSystemMessage('Please load a model first before sending a message.', true);
            return;
        }
        
        // Add user message to chat
        addUserMessage(message);
        
        // Clear input
        chatInput.value = '';
        chatInput.style.height = '50px';
        
        // Disable inputs during generation
        chatInput.disabled = true;
        sendMessageButton.disabled = true;
        
        // Current response text
        let currentResponseText = '';
        
        // Generate response
        webLLMEngine.generateResponse(message, (token) => {
            // Handle first token
            if (currentResponseText === '') {
                addAIMessage('');
            }
            
            // Append token
            currentResponseText += token;
            
            // Update the most recent AI message
            updateLatestAIMessage(currentResponseText);
            
            // Scroll to bottom
            scrollToBottom();
        }).then(() => {
            // Re-enable inputs after generation
            chatInput.disabled = false;
            sendMessageButton.disabled = false;
            chatInput.focus();
        }).catch((error) => {
            console.error('Error generating response:', error);
            
            // Add error message
            addSystemMessage(`Error generating response: ${error.message || 'Unknown error'}`, true);
            
            // Re-enable inputs
            chatInput.disabled = false;
            sendMessageButton.disabled = false;
        });
    }
    
    // Send message button click
    sendMessageButton.addEventListener('click', sendMessage);
    
    // Send message on Enter (but not with Shift)
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = '50px';
        chatInput.style.height = `${Math.min(chatInput.scrollHeight, 150)}px`;
    });
    
    // Add system message to chat
    function addSystemMessage(text, isError = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'system-message');
        
        if (isError) {
            messageDiv.classList.add('error');
        }
        
        messageDiv.innerHTML = `
            <div class="message-content">${text}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Add user message to chat
    function addUserMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'user-message');
        
        messageDiv.innerHTML = `
            <div class="message-header">You</div>
            <div class="message-content">${escapeHTML(text)}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Add AI message to chat
    function addAIMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'ai-message');
        
        messageDiv.innerHTML = `
            <div class="message-header">AI</div>
            <div class="message-content">${escapeHTML(text)}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Update the latest AI message content
    function updateLatestAIMessage(text) {
        const aiMessages = chatMessages.querySelectorAll('.ai-message');
        if (aiMessages.length > 0) {
            const latestMessage = aiMessages[aiMessages.length - 1];
            const contentDiv = latestMessage.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.textContent = text;
            }
        }
    }
    
    // Scroll chat to bottom
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Escape HTML to prevent XSS
    function escapeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Add floating chat button styles
function addChatButtonStyles() {
    const style = document.createElement('style');
    style.textContent = `
    .floating-button {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background-color: #4a86e8;
        color: white;
        border: none;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        transition: transform 0.2s ease, background-color 0.3s ease;
    }
    
    .floating-button:hover {
        background-color: #3b78e7;
        transform: scale(1.05);
    }
    
    .floating-button .material-symbols-rounded {
        font-size: 24px;
    }
    `;
    document.head.appendChild(style);
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // ... existing initialization code ...
    
    // Initialize chat UI
    addChatButtonStyles();
    initializeChatUI();
}); 