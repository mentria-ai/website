// Animated Text Functionality
document.addEventListener('DOMContentLoaded', function() {
    // Get debug logger from utils.js
    const debug = window.debug.createLogger('AnimatedText');
    
    debug.log('Initializing animated text module');
    
    // Elements
    const animatedTextContainer = document.querySelector('.animated-text-container');
    const animatedText = document.querySelector('.animated-text');
    const autoplayBtn = document.getElementById('autoplayBtn');
    const progressFill = document.getElementById('progressFill');
    
    // Create audio element - will be updated with quote-specific audio
    const audioPlayer = new Audio();
    audioPlayer.loop = true; // Enable looping
    audioPlayer.muted = true; // Start muted by default
    audioPlayer.preload = "auto"; // Preload audio when possible
    
    // Current quote information
    let currentQuoteId = null;
    
    // Track if user has interacted with the page
    let hasUserInteracted = false;
    
    // Global navigation lock to prevent simultaneous quote changes
    let isChangingQuote = false;
    let lastNavigationTime = 0;
    
    // Global flag to track if a navigation is pending
    let pendingNavigation = null;
    
    // Enhanced debounce for quote changes
    let pendingQuoteChange = null;
    let lastQuoteChangeTime = 0;
    const debounceDelay = 300; // ms to wait before processing a new quote change
    
    // Animation state
    let currentAnimation = null;
    let isAnimating = false;
    let currentQuote = '';
    let wordDelay = 5; // ms between words - Much shorter now
    let isMuted = true; // Start muted by default
    
    // Track animation completion status
    let animationComplete = true;
    
    // Global logging function for debugging
    window.logNavigationEvent = function(source, action, data) {
        debug.log(`[Navigation:${source}] ${action}`, data);
    };
    
    // Debug tracking variables
    window._navigationDebug = {
        lastClick: 0,
        activeNavigation: false,
        pendingRequestCount: 0,
        history: []
    };
    
    debug.log('Found elements:', {
        container: !!animatedTextContainer,
        text: !!animatedText,
        autoplayBtn: !!autoplayBtn,
        progressFill: !!progressFill,
        audioPlayer: !!audioPlayer
    });
    
    // Function to determine word emphasis
    function getWordEmphasis(word, index, totalWords, allWords) {
        // Remove punctuation for checking
        const cleanWord = word.replace(/[.,!?;:'"]/g, '').toLowerCase();
        
        // Words that improve readability for fact-based content
        const readabilityWords = [
            'while', 'when', 'where', 'how', 'which', 'what', 'who',
            'then', 'there', 'these', 'those', 'this', 'that',
            'first', 'second', 'finally', 'lastly', 'before', 'after',
            'inside', 'outside', 'above', 'below', 'between', 'among',
            'through', 'within', 'during', 'because', 'although',
            'despite', 'however', 'therefore', 'moreover', 'furthermore',
            'actually', 'interestingly', 'surprisingly', 'fascinatingly',
            'approximately', 'nearly', 'roughly', 'about', 'almost',
            'precisely', 'exactly', 'specifically', 'generally'
        ];
        
        // Common filler words to avoid highlighting as important
        const fillerWords = [
            'the', 'a', 'an', 'and', 'but', 'or', 'of', 'to', 'in', 'on',
            'at', 'by', 'for', 'with', 'from', 'as', 'into', 'it', 'its',
            'is', 'are', 'was', 'were', 'be', 'being', 'been', 'have', 'has', 'had',
            'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
            'must', 'ought', 'i', 'you', 'he', 'she', 'they', 'we', 'them', 'us',
            'very', 'so', 'too', 'also', 'just', 'only', 'even', 'still'
        ];
        
        // Empty emphasis by default
        let emphasis = '';
        
        // Apply emphasis-2 only to words that improve readability
        if (readabilityWords.includes(cleanWord)) {
            emphasis = 'emphasis-2';
        }
        
        return emphasis;
    }
    
    // Function to identify the most important word in a quote
    function findMostImportantWord(words) {
        // Skip if there are no words
        if (!words || !words.length) return null;
        
        // Words that shouldn't be considered as most important
        const unimportantWords = [
            'the', 'a', 'an', 'and', 'but', 'or', 'of', 'to', 'in', 'on',
            'at', 'by', 'for', 'with', 'from', 'as', 'into', 'it', 'its',
            'is', 'are', 'was', 'were', 'be', 'being', 'been', 'have', 'has', 'had',
            'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
            'must', 'ought', 'i', 'you', 'he', 'she', 'they', 'we', 'them', 'us',
            'very', 'so', 'too', 'also', 'just', 'only', 'even', 'still'
        ];
        
        // Words that are more likely to be important (high content value)
        const potentiallyImportantWords = words
            .map(word => ({
                original: word,
                clean: word.replace(/[.,!?;:'"]/g, '').toLowerCase(),
                length: word.replace(/[.,!?;:'"]/g, '').length,
                isCapitalized: /^[A-Z][a-z]/.test(word)
            }))
            // Remove common unimportant words
            .filter(w => !unimportantWords.includes(w.clean) && w.length > 2);
            
        // No qualifying words found
        if (potentiallyImportantWords.length === 0) return null;
        
        // Scoring system for finding the most important word
        const scoredWords = potentiallyImportantWords.map(word => {
            let score = 0;
            
            // Capitalized words are often important
            if (word.isCapitalized) score += 3;
            
            // Longer words often carry more meaning (up to a point)
            score += Math.min(5, word.length / 2);
            
            // Words in the middle of a quote are often important
            const position = words.indexOf(word.original) / words.length;
            if (position > 0.3 && position < 0.7) score += 1;
            
            // Prefer words with special characters indicating emphasis
            if (word.original.includes('*') || word.original.includes('_')) score += 2;
            
            return {
                ...word,
                score
            };
        });
        
        // Sort by score descending and return the highest scored word
        scoredWords.sort((a, b) => b.score - a.score);
        return scoredWords.length > 0 ? scoredWords[0].original : null;
    }
    
    // Function to adjust container height based on content
    function adjustContainerHeight() {
        if (!animatedTextContainer || !animatedText) return;
        
        // Get the height of the content
        const contentHeight = animatedText.offsetHeight;
        
        // Set the container height to match the content height (with min and max constraints)
        if (contentHeight > 0) {
            // The CSS will handle min-height and max-height constraints
            animatedTextContainer.style.height = `${contentHeight + 24}px`; // 24px for padding
        }
    }
    
    // Function to animate quote
    function animateQuote(quote, emphasisData = {}) {
        if (!animatedText) {
            return;
        }
        
        // Check if there's an active navigation in quotes.js
        if (window.quoteNavigation && typeof window.quoteNavigation.isNavigating === 'function' && 
            window.quoteNavigation.isNavigating()) {
            
            debug.log('Animation requested during active navigation - delaying animation');
            
            // Wait a short time and check again
            setTimeout(() => {
                if (!window.quoteNavigation.isNavigating()) {
                    animateQuote(quote, emphasisData);
                } else {
                    debug.log('Navigation still active, animation deferred');
                }
            }, 100);
            
            return;
        }
        
        if (isAnimating) {
            clearTimeout(currentAnimation);
        }
        
        // Reset animation state
        isAnimating = true;
        animationComplete = false;
        currentQuote = quote;
        animatedText.innerHTML = '';
        
        // Special handling for "Did you know?" prefix
        let processedQuote = quote;
        const didYouKnowPrefix = "Did you know?";
        
        // Create a special element for the prefix if it exists
        if (quote.trim().startsWith(didYouKnowPrefix)) {
            const prefixElement = document.createElement('div');
            prefixElement.className = 'word-container visible';
            
            const prefixSpan = document.createElement('span');
            prefixSpan.className = 'word emphasis-1'; // Always highlight the prefix
            prefixSpan.textContent = didYouKnowPrefix + ' ';
            prefixElement.appendChild(prefixSpan);
            
            // Append the prefix to the container
            animatedText.appendChild(prefixElement);
            
            // Remove the prefix from the quote for further processing
            processedQuote = quote.trim().substring(didYouKnowPrefix.length).trim();
        }
        
        // Split quote into words
        const words = processedQuote.split(' ');
        
        // IMPORTANT: Use a fixed animation time for consistency regardless of source
        const totalAnimationTime = 150; // 0.15 seconds total animation time
        wordDelay = 0; // No delay between words - make all appear at once for consistency
        
        // Count of emphasis-1 to make sure we use it sparingly
        let emphasis1Count = 0;
        const maxEmphasis1 = 1; // Only allow at most 1 emphasis-1 per quote
        
        // Identify the most important word if no emphasis-1 is provided in data
        let mostImportantWord = null;
        
        // Check if emphasis data already contains an emphasis-1 word
        if (emphasisData) {
            for (const word in emphasisData) {
                if (emphasisData[word] === 'emphasis-1') {
                    mostImportantWord = word;
                    emphasis1Count++;
                    break;
                }
            }
        }
        
        // If no emphasis-1 word was specified, find the most important word
        if (!mostImportantWord) {
            mostImportantWord = findMostImportantWord(words);
            if (mostImportantWord) {
                // Add it to the emphasis data
                const cleanWord = mostImportantWord.replace(/[.,!?;:'"]/g, '').toLowerCase();
                emphasisData = emphasisData || {};
                emphasisData[cleanWord] = 'emphasis-1';
                emphasis1Count = 1;
                debug.log(`Auto-selected most important word: "${mostImportantWord}"`);
            }
        }
        
        // First create all word elements
        const wordElements = [];
        
        words.forEach((word, index) => {
            // Get emphasis from data or determine it
            const cleanWord = word.replace(/[.,!?;:'"]/g, '').toLowerCase();
            let emphasis = '';
            
            if (emphasisData && emphasisData[cleanWord]) {
                emphasis = emphasisData[cleanWord];
                // Count emphasis-1 words from the data
                if (emphasis === 'emphasis-1') {
                    emphasis1Count++;
                }
            } else {
                emphasis = getWordEmphasis(word, index, words.length, words);
            }
            
            // Create word element with the appropriate emphasis
            const element = document.createElement('div');
            element.className = 'word-container';
            
            if (emphasis === 'emphasis-3') {
                // Create link for emphasis-3
                const anchor = document.createElement('a');
                anchor.href = `#${cleanWord}`; // Placeholder link
                anchor.rel = 'nofollow noopener';
                anchor.target = '_blank';
                anchor.className = 'word emphasis-3';
                anchor.textContent = word;
                element.appendChild(anchor);
            } else {
                // Create regular span for other emphases
                const wordSpan = document.createElement('span');
                wordSpan.className = `word ${emphasis}`;
                wordSpan.textContent = word;
                element.appendChild(wordSpan);
            }
            
            wordElements.push({
                element,
                word,
                emphasis,
                index
            });
        });
        
        // Ensure we only use emphasis-1 sparingly (remove excess if needed)
        if (emphasis1Count > maxEmphasis1) {
            // Find all emphasis-1 words
            const emphasis1Words = wordElements.filter(item => item.emphasis === 'emphasis-1');
            
            // Keep only the first one and change others to no emphasis
            for (let i = 1; i < emphasis1Words.length; i++) {
                const wordEl = emphasis1Words[i].element.querySelector('.word');
                if (wordEl) {
                    wordEl.className = 'word'; // Remove emphasis
                }
            }
        }
        
        // Append all word elements to the container
        wordElements.forEach(item => {
            animatedText.appendChild(item.element);
        });
        
        // Now adjust container height to fit all content
        adjustContainerHeight();
        
        // Animation strategy: make all words appear almost simultaneously for consistency
        wordElements.forEach((item, index) => {
            // Add a very small staggered delay just for visual effect
            const delay = Math.min(5, index * 2);
            
            currentAnimation = setTimeout(() => {
                item.element.classList.add('visible');
                
                // If this is the last word
                if (index === wordElements.length - 1) {
                    setTimeout(() => {
                        isAnimating = false;
                        animationComplete = true;
                        
                        // Process any pending navigation after animation completes
                        if (pendingNavigation) {
                            debug.log('Processing pending navigation after animation');
                            const navFunc = pendingNavigation;
                            pendingNavigation = null;
                            navFunc();
                        }
                        
                        // Process any pending quote change
                        if (pendingQuoteChange) {
                            debug.log('Processing pending quote change after animation');
                            const changeData = pendingQuoteChange;
                            pendingQuoteChange = null;
                            handleQuoteChange(changeData);
                        }
                    }, 50);
                }
            }, delay);
        });
    }
    
    // Variables to manage audio loading
    let lastAudioRequest = null;
    let audioLoadingInProgress = false;
    let audioDebounceTimeout = null;
    
    // Function to load and play the appropriate audio
    function loadAndPlayAudio() {
        if (!currentQuoteId) return;
        
        const quoteNumber = currentQuoteId.split('_')[1];
        const quoteAudioPath = `assets/audio/quotes/quote_${quoteNumber}.mp3`;
        const fallbackAudioPath = 'assets/audio/radio.mp3';
        
        // If this is the same audio request as the last one and it's still in progress, skip
        if (lastAudioRequest === quoteAudioPath && audioLoadingInProgress) {
            debug.log(`Skipping duplicate audio request: ${quoteAudioPath}`);
            return;
        }
        
        // Clear any pending audio debounce
        if (audioDebounceTimeout) {
            clearTimeout(audioDebounceTimeout);
        }
        
        // Set a short debounce to prevent multiple rapid audio loads
        audioDebounceTimeout = setTimeout(() => {
            // Remember this request
            lastAudioRequest = quoteAudioPath;
            audioLoadingInProgress = true;
            
            debug.log(`Loading audio: ${quoteAudioPath}, fallback: ${fallbackAudioPath}`);
            
            // If previous audio is still playing, stop it
            if (audioPlayer.src) {
                // Save volume and mute settings
                const wasMuted = audioPlayer.muted;
                const volume = audioPlayer.volume;
                
                // Reset the audio
                audioPlayer.pause();
                audioPlayer.currentTime = 0;
                
                // Start loading the new audio
                fetch(quoteAudioPath, { method: 'HEAD' })
                    .then(response => {
                        if (response.ok) {
                            debug.log(`Quote audio found: ${quoteAudioPath}`);
                            audioPlayer.src = quoteAudioPath;
                        } else {
                            debug.log(`Using fallback audio: ${fallbackAudioPath}`);
                            // Try fallback audio
                            audioPlayer.src = fallbackAudioPath;
                        }
                        
                        // Restore settings
                        audioPlayer.muted = wasMuted;
                        audioPlayer.volume = volume;
                        
                        // Play if appropriate
                        if (!wasMuted) {
                            safelyPlayAudio();
                        }
                        
                        // Always update progress bar
                        updateProgressBar();
                        
                        // Mark audio loading as complete
                        audioLoadingInProgress = false;
                    })
                    .catch(error => {
                        debug.error(`Error loading audio: ${error}`);
                        // Just use fallback
                        audioPlayer.src = fallbackAudioPath;
                        audioPlayer.muted = wasMuted;
                        audioPlayer.volume = volume;
                        
                        if (!wasMuted) {
                            safelyPlayAudio();
                        }
                        updateProgressBar();
                        
                        // Mark audio loading as complete
                        audioLoadingInProgress = false;
                    });
            } else {
                // First time loading audio
                audioPlayer.src = quoteAudioPath;
                
                // Play if not muted
                if (!isMuted) {
                    safelyPlayAudio();
                }
                
                // Update progress bar
                updateProgressBar();
                
                // Mark audio loading as complete
                audioLoadingInProgress = false;
            }
        }, 50); // Short debounce to prevent multiple load calls
    }
    
    // Function to restart the animation
    function restartAnimation() {
        if (currentQuote) {
            fadeOutWords(() => {
                // Start new animation
                animateQuote(currentQuote);
            });
        }
    }
    
    // Function to fade out words - now much faster
    function fadeOutWords(callback) {
        const wordContainers = animatedText.querySelectorAll('.word-container');
        let completed = 0;
        
        if (wordContainers.length === 0) {
            if (callback) callback();
            return;
        }
        
        // Make all words fade out almost simultaneously with minimal delays
        wordContainers.forEach((container, index) => {
            setTimeout(() => {
                container.style.opacity = '0';
                container.style.transform = 'translateY(-10px)';
                
                completed++;
                if (completed === wordContainers.length && callback) {
                    setTimeout(callback, 50); // Reduced delay
                }
            }, index * 5); // Very short delay between words
        });
    }
    
    // Function to safely play audio without errors
    function safelyPlayAudio() {
        if (!audioPlayer || !audioPlayer.src) return;
        
        // Only attempt to play if user has interacted with the page
        if (hasUserInteracted) {
            // Reset the audio position if needed
            if (audioPlayer.currentTime > 0 && audioPlayer.currentTime >= audioPlayer.duration) {
                audioPlayer.currentTime = 0;
            }
            
            // Actually try to play
            const playPromise = audioPlayer.play();
            
            // Handle the promise (only exists in newer browsers)
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn('Could not play audio:', error);
                    
                    // If autoplay was prevented, we'll need user interaction
                    if (error.name === 'NotAllowedError') {
                        // We'll set up the one-time interaction event handler
                        // if it's not already set up
                        setupUserInteractionHandlers();
                    }
                });
            }
        } else {
            // Setup handlers for first user interaction
            setupUserInteractionHandlers();
        }
    }
    
    // Set up handlers for first user interaction
    function setupUserInteractionHandlers() {
        if (!window._audioInteractionListenerSet) {
            window._audioInteractionListenerSet = true;
            const interactionEvents = ['click', 'touchstart', 'keydown'];
            
            const handleFirstInteraction = () => {
                hasUserInteracted = true;
                
                // Try playing current audio
                audioPlayer.play().catch(e => {
                    console.error('Still could not play audio after interaction:', e);
                });
                
                // Remove the listeners after first interaction
                interactionEvents.forEach(event => {
                    document.removeEventListener(event, handleFirstInteraction);
                });
            };
            
            // Add listeners for first interaction
            interactionEvents.forEach(event => {
                document.addEventListener(event, handleFirstInteraction, { once: true });
            });
        }
    }

    // Function to toggle audio mute state
    function toggleAudio() {
        if (!audioPlayer) return;
        
        // Mark that user has interacted
        hasUserInteracted = true;
        
        if (isMuted) {
            // Unmute audio
            audioPlayer.muted = false;
            isMuted = false;
            updateAudioButton(false);
            
            // Try to play the audio
            safelyPlayAudio();
            
            // Update progress bar to reflect audio progress
            updateProgressBar();
        } else {
            // Mute audio
            audioPlayer.muted = true;
            isMuted = true;
            updateAudioButton(true);
        }
    }

    // Function to update progress bar based on audio playback
    function updateProgressBar() {
        if (!progressFill || !audioPlayer) return;
        
        // Remove existing listeners to prevent duplicates
        audioPlayer.removeEventListener('timeupdate', updateOnTimeUpdate);
        audioPlayer.removeEventListener('seeking', updateOnSeeking);
        audioPlayer.removeEventListener('loadedmetadata', updateOnMetadataLoaded);
        audioPlayer.removeEventListener('canplay', updateOnCanPlay);
        
        // Reset progress bar if the audio isn't ready
        if (!audioPlayer.src || audioPlayer.readyState === 0) {
            progressFill.style.transform = 'scaleX(0)';
        }
        
        // Update progress bar immediately
        const updateProgress = () => {
            if (!audioPlayer.duration || isNaN(audioPlayer.duration)) {
                // Reset progress if duration is not available
                progressFill.style.transform = 'scaleX(0)';
                return;
            }
            
            const progress = audioPlayer.currentTime / audioPlayer.duration;
            
            // Ensure progress is between 0-1
            const clampedProgress = Math.max(0, Math.min(1, progress));
            progressFill.style.transform = `scaleX(${clampedProgress})`;
        };
        
        // Function to be called on timeupdate
        function updateOnTimeUpdate() {
            // Update the progress directly rather than using transition for more accurate tracking
            updateProgress();
        }
        
        // Function to be called on seeking
        function updateOnSeeking() {
            updateProgress();
        }
        
        // Function to be called when metadata is loaded
        function updateOnMetadataLoaded() {
            updateProgress();
        }
        
        // Function to be called when audio can play
        function updateOnCanPlay() {
            updateProgress();
        }
        
        // Initial update if possible
        if (audioPlayer.readyState > 0 && audioPlayer.duration) {
            updateProgress();
        } else {
            progressFill.style.transform = 'scaleX(0)';
        }
        
        // Add event listeners
        audioPlayer.addEventListener('timeupdate', updateOnTimeUpdate);
        audioPlayer.addEventListener('seeking', updateOnSeeking);
        audioPlayer.addEventListener('loadedmetadata', updateOnMetadataLoaded);
        audioPlayer.addEventListener('canplay', updateOnCanPlay);
    }

    // Update audio button appearance for mute/unmute
    function updateAudioButton(muted) {
        if (!autoplayBtn) return;
        
        const icon = autoplayBtn.querySelector('i');
        if (icon) {
            icon.className = muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
        }
        autoplayBtn.classList.toggle('muted', muted);
        autoplayBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    }
    
    // Debounced quote change handler with improved navigation awareness
    function handleQuoteChange(detail) {
        // Add to debug history
        window._navigationDebug.history.push({
            timestamp: new Date().toISOString(),
            action: 'handleQuoteChange',
            detail: { id: detail?.id, quote: detail?.quote?.substring(0, 20) + '...' }
        });
        
        debug.log(`Quote change called for ID: ${detail?.id}`, { 
            isChangingQuote, 
            currentQuoteId,
            animationInProgress: isAnimating,
            animationComplete,
            forceUpdate: detail?.forceUpdate,
            scrollInitiated: detail?.scrollInitiated,
            navLockActive: window.quoteNavigation && typeof window.quoteNavigation.isNavigating === 'function' ? 
                window.quoteNavigation.isNavigating() : false
        });

        // If not a valid quote change, ignore it
        if (!detail || !detail.quote || !detail.id) {
            debug.warn("Skipping quote change - invalid data", detail);
            return;
        }
        
        // If this is the same quote request that's already in progress, don't duplicate it
        if (detail.id === currentQuoteId && !detail.forceUpdate) {
            if (detail.id === currentQuoteId && currentQuote === detail.quote) {
                debug.log("Same quote requested, ignoring", detail.id);
                return;
            }
        }
        
        // IMPORTANT: If this is a force update, we need to handle it regardless of busy state
        if (detail.forceUpdate) {
            debug.log(`Force update received for ${detail.id} - processing immediately`);
            processImmediately();
            return;
        }
        
        // Check various busy states to determine if we should queue this request
        const quoteManagerNavigating = window.quoteNavigation && 
                                      typeof window.quoteNavigation.isNavigating === 'function' && 
                                      window.quoteNavigation.isNavigating();
                                      
        const busy = isChangingQuote || 
                    isAnimating || 
                    !animationComplete || 
                    quoteManagerNavigating;
        
        // If we're in the middle of a change or navigation, queue this one for later
        // UNLESS it was initiated by scrolling (which means the image already changed)
        if (busy && !detail.scrollInitiated) {
            debug.log(`System busy, queueing quote change to ${detail.id}. Status:`, {
                isChangingQuote,
                isAnimating,
                animationComplete,
                quoteManagerNavigating
            });
            
            // Store the request for later processing
            pendingQuoteChange = detail;
            
            // Return without processing now
            return;
        }
        
        // Process the quote change immediately
        processImmediately();
        
        // Helper function to process quote changes immediately
        function processImmediately() {
            // Set the global lock and update state variables
            isChangingQuote = true;
            window._navigationDebug.activeNavigation = true;
            lastNavigationTime = Date.now();
            
            // Clear any pending changes
            if (pendingQuoteChange) {
                pendingQuoteChange = null;
            }
            
            // Update current quote ID first
            const previousQuoteId = currentQuoteId;
            currentQuoteId = detail.id;
            
            debug.log(`Processing quote change from ${previousQuoteId} to ${currentQuoteId}`);
            
            // Process quote change - animation and audio loading
            // Use a consistent approach for all change types
                fadeOutWords(() => {
                // Start loading audio FIRST, before animation - this reduces the double-play issue
                // by ensuring audio is ready or loading before text animations complete
                loadAndPlayAudio();
                
                // Then start animating text - with new faster animation settings
                setTimeout(() => {
                    animateQuote(detail.quote, detail.emphasis || {});
                    
                    // Release the lock after a delay to ensure everything has time to update
                    setTimeout(() => {
                        debug.log(`Releasing quote change lock for ${currentQuoteId}`);
                        isChangingQuote = false;
                        window._navigationDebug.activeNavigation = false;
                    }, 300); // Shorter delay for better responsiveness
                }, 50); // Small delay to let audio start loading first
            });
        }
    }
    
    // Setup event listeners
    function setupEventListeners() {
        // Audio control (now for mute/unmute)
        if (autoplayBtn) {
            autoplayBtn.addEventListener('click', toggleAudio);
            
            // Update the icon initially to show the volume icon
            updateAudioButton(isMuted);
            
            // Handle audio loading errors
            audioPlayer.addEventListener('error', (e) => {
                console.error('Audio error:', e);
                // Try to recover by playing default audio
                audioPlayer.src = 'assets/audio/radio.mp3';
                audioPlayer.play().catch(err => {
                    console.error('Error playing fallback audio after error:', err);
                });
            });
        }

        // Double-click to replay animation
        if (animatedTextContainer) {
            animatedTextContainer.addEventListener('dblclick', restartAnimation);
        }

        // Listen for quote changes with better debounce and navigation awareness
        document.addEventListener('quoteChanged', function(e) {
            if (e.detail && e.detail.quote) {
                handleQuoteChange(e.detail);
            }
        });
        
        // Listen for window resize to adjust container height
        window.addEventListener('resize', adjustContainerHeight);

        // Override window.quoteNavigation functions to ensure they respect animation state
        if (window.quoteNavigation) {
            const originalNext = window.quoteNavigation.next;
            const originalPrev = window.quoteNavigation.prev;
            
            window.quoteNavigation.next = function() {
                // If already navigating or animating, queue this for later
                if (isChangingQuote || isAnimating || !animationComplete) {
                    debug.log('Next navigation requested while busy, queueing');
                    pendingNavigation = originalNext;
                    return;
                }
                
                // Otherwise proceed immediately
                originalNext();
            };
            
            window.quoteNavigation.prev = function() {
                // If already navigating or animating, queue this for later
                if (isChangingQuote || isAnimating || !animationComplete) {
                    debug.log('Previous navigation requested while busy, queueing');
                    pendingNavigation = originalPrev;
                    return;
                }
                
                // Otherwise proceed immediately
                originalPrev();
            };
            
            debug.log('Navigation functions overridden to respect animation state');
        }

        // Handle clicks on navigation buttons to prevent rapid clicking issues
        document.querySelectorAll('.control-icon[onclick*="quoteNavigation"]').forEach(button => {
            // Remove the inline onclick attribute
            const onclickValue = button.getAttribute('onclick');
            button.removeAttribute('onclick');
            
            // Create a debounced click handler
            let isNavigating = false;
            let navigationTimeout = null;
            
            button.addEventListener('click', function(e) {
                // Prevent default to stop any other handlers
                e.preventDefault();
                e.stopPropagation();
                
                // Record click time for debugging
                window._navigationDebug.lastClick = Date.now();
                
                // If already navigating, ignore this click
                if (isNavigating || isChangingQuote || isAnimating || !animationComplete) {
                    debug.log('Navigation button clicked while busy - ignoring');
                    return;
                }
                
                // Set navigating flag to prevent rapid clicks
                isNavigating = true;
                
                // Determine which navigation function to call based on original onclick
                if (onclickValue.includes('next()')) {
                    if (window.quoteNavigation && typeof window.quoteNavigation.next === 'function') {
                        window.quoteNavigation.next();
                    }
                } else if (onclickValue.includes('prev()')) {
                    if (window.quoteNavigation && typeof window.quoteNavigation.prev === 'function') {
                        window.quoteNavigation.prev();
                    }
                }
                
                // Clear any existing timeout
                if (navigationTimeout) {
                    clearTimeout(navigationTimeout);
                }
                
                // Reset the flag after a delay to allow the animation to complete
                navigationTimeout = setTimeout(() => {
                    isNavigating = false;
                }, 800); // 800ms should be enough for the transition to complete
            });
            
            debug.log('Navigation button updated:', { button: button.className });
        });
    }
    
    // Initialize the module
    function init() {
        if (!animatedTextContainer || !animatedText) {
            console.error('Required elements not found!');
            return;
        }
        
        // Set initial height for the container to avoid the fixed height issue on page load
        if (animatedTextContainer) {
            // Set the initial height to the min-height from CSS
            animatedTextContainer.style.height = 'var(--min-height, 80px)';
            
            // Add a small delay to ensure the DOM is fully loaded and styled
            setTimeout(() => {
                adjustContainerHeight();
            }, 100);
        }
        
        setupEventListeners();
    }
    
    // Start the module
    init();
    
    // Expose functions to window for external access
    window.animatedText = {
        animate: animateQuote,
        restart: restartAnimation,
        toggleMute: toggleAudio,
        isAnimating: () => isAnimating || !animationComplete
    };
}); 