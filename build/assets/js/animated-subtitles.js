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
    
    // Create audio element
    const audioPlayer = new Audio('assets/audio/radio.mp3');
    audioPlayer.loop = true; // Enable looping
    
    debug.log('Found elements:', {
        container: !!animatedTextContainer,
        text: !!animatedText,
        autoplayBtn: !!autoplayBtn,
        progressFill: !!progressFill,
        audioPlayer: !!audioPlayer
    });
    
    // Animation state
    let currentAnimation = null;
    let isAnimating = false;
    let currentQuote = '';
    let wordDelay = 5; // ms between words - Much shorter now
    let isPlaying = false;
    let lastQuoteChangeTime = 0;
    let pendingQuoteChange = null;
    const debounceDelay = 300; // ms to wait before processing a new quote change
    let autoplayInterval = null; // Interval for auto-advancing slides
    const slideAdvanceTime = 7000; // 7 seconds between slide advances
    
    // Function to determine word emphasis
    function getWordEmphasis(word, index, totalWords) {
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
        
        // Empty emphasis by default
        let emphasis = '';
        
        // Apply emphasis-2 only to words that improve readability
        if (readabilityWords.includes(cleanWord)) {
            emphasis = 'emphasis-2';
        }
        
        // emphasis-3 is disabled for now
        
        return emphasis;
    }
    
    // Function to create a word element with styling
    function createWordElement(word, index, totalWords, emphasisFromData) {
        debug.log('Creating word element:', { word, index, emphasisFromData });
        
        const container = document.createElement('div');
        container.className = 'word-container';
        
        const wordSpan = document.createElement('span');
        const cleanWord = word.replace(/[.,!?;:'"]/g, '').toLowerCase();
        
        // Use emphasis provided in data if available
        let emphasis = '';
        if (emphasisFromData && emphasisFromData[cleanWord]) {
            emphasis = emphasisFromData[cleanWord];
        } else {
            emphasis = getWordEmphasis(word, index, totalWords);
        }
        
        wordSpan.className = `word ${emphasis}`;
        wordSpan.textContent = word;
        
        // If this is a link (emphasis-3), create an anchor element
        if (emphasis === 'emphasis-3') {
            const anchor = document.createElement('a');
            anchor.href = `#${cleanWord}`; // Placeholder link
            anchor.rel = 'nofollow noopener';
            anchor.target = '_blank';
            anchor.className = 'word emphasis-3';
            anchor.textContent = word;
            
            // Replace the wordSpan with the anchor in the container
            container.innerHTML = '';
            container.appendChild(anchor);
        } else {
            container.appendChild(wordSpan);
        }
        
        return container;
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
        debug.log('Starting quote animation:', { quote, emphasisData });
        
        if (!animatedText) {
            debug.error('Animated text element not found');
            return;
        }
        
        if (isAnimating) {
            debug.log('Clearing previous animation');
            clearTimeout(currentAnimation);
        }
        
        // Reset animation state
        isAnimating = true;
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
        const totalAnimationTime = 200; // 0.2 seconds total animation time
        wordDelay = Math.max(5, totalAnimationTime / words.length); // Make sure we have at least 5ms delay
        
        debug.log('Animation setup:', { 
            totalWords: words.length, 
            wordDelay, 
            totalAnimationTime 
        });
        
        // Count of emphasis-1 to make sure we use it sparingly
        let emphasis1Count = 0;
        const maxEmphasis1 = 1; // Only allow at most 1 emphasis-1 per quote
        
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
                emphasis = getWordEmphasis(word, index, words.length);
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
        
        // Animate all words with minimal delays
        wordElements.forEach((item, index) => {
            currentAnimation = setTimeout(() => {
                debug.log('Animating word:', { word: item.word, index });
                item.element.classList.add('visible');
                
                // If this is the last word
                if (index === wordElements.length - 1) {
                    setTimeout(() => {
                        isAnimating = false;
                        debug.log('Animation complete');
                    }, 50);
                }
            }, index * wordDelay);
        });
    }
    
    // Function to restart the animation
    function restartAnimation() {
        debug.log('Restarting animation');
        if (currentQuote) {
            fadeOutWords(() => {
                // Start new animation
                animateQuote(currentQuote);
            });
        }
    }
    
    // Function to fade out words - now much faster
    function fadeOutWords(callback) {
        debug.log('Fading out words');
        const wordContainers = animatedText.querySelectorAll('.word-container');
        let completed = 0;
        
        if (wordContainers.length === 0) {
            debug.log('No words to fade out');
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
                    debug.log('Fade out complete');
                    setTimeout(callback, 50); // Reduced delay
                }
            }, index * 5); // Very short delay between words
        });
    }
    
    // Function to toggle audio playback and autoplay
    function toggleAudio() {
        if (!audioPlayer) return;
        
        if (isPlaying) {
            // Stop audio
            audioPlayer.pause();
            isPlaying = false;
            updateAudioButton(false);
            
            // Stop auto-advancing slides
            if (autoplayInterval) {
                clearInterval(autoplayInterval);
                autoplayInterval = null;
                debug.log('Autoplay stopped');
            }
            
            // Reset progress bar transition
            if (progressFill) {
                progressFill.style.transition = 'none';
                progressFill.style.transform = 'scaleX(0)';
            }
        } else {
            // Start audio
            audioPlayer.play().catch(error => {
                debug.error('Error playing audio:', error);
                return;
            });
            isPlaying = true;
            updateAudioButton(true);
            
            // Start auto-advancing slides
            autoplayInterval = setInterval(() => {
                debug.log('Auto-advancing slide');
                if (window.quoteNavigation && typeof window.quoteNavigation.next === 'function') {
                    window.quoteNavigation.next();
                }
            }, slideAdvanceTime);
            debug.log('Autoplay started, slides will advance every', slideAdvanceTime/1000, 'seconds');
            
            // Update progress bar to reflect audio progress
            updateProgressBar();
        }
    }

    // Function to update progress bar based on audio playback
    function updateProgressBar() {
        if (!progressFill || !audioPlayer) return;
        
        // Update progress bar immediately
        const updateProgress = () => {
            const progress = audioPlayer.currentTime / audioPlayer.duration;
            progressFill.style.transform = `scaleX(${progress})`;
        };
        
        // Set transition based on remaining time
        const setTransition = () => {
            if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
                const remainingTime = (audioPlayer.duration - audioPlayer.currentTime) * 1000;
                progressFill.style.transition = `transform ${remainingTime}ms linear`;
                progressFill.style.transform = 'scaleX(1)';
                debug.log('Progress bar transition set for', remainingTime, 'ms');
            }
        };
        
        // Initial update and transition setup
        if (audioPlayer.readyState > 0) {
            updateProgress();
            setTransition();
        }
        
        // Listen for timeupdate events to handle any seeking
        audioPlayer.addEventListener('timeupdate', () => {
            if (!isPlaying) return;
            
            // If we're close to the beginning, set the transition for the entire duration
            if (audioPlayer.currentTime < 0.5) {
                progressFill.style.transition = `transform ${audioPlayer.duration * 1000}ms linear`;
                progressFill.style.transform = 'scaleX(1)';
            }
        });
        
        // Reset progress when audio loops or is reset
        audioPlayer.addEventListener('seeking', updateProgress);
        
        // Handle audio loaded (metadata might not be available immediately)
        audioPlayer.addEventListener('loadedmetadata', () => {
            updateProgress();
            setTransition();
        });
    }

    // Update audio button appearance
    function updateAudioButton(playing) {
        if (!autoplayBtn) return;
        
        const icon = autoplayBtn.querySelector('i');
        if (icon) {
            icon.className = playing ? 'fas fa-pause' : 'fas fa-play';
        }
        autoplayBtn.classList.toggle('playing', playing);
        autoplayBtn.setAttribute('aria-label', playing ? 'Pause autoplay' : 'Start autoplay');
    }
    
    // Debounced quote change handler
    function handleQuoteChange(detail) {
        // Clear any pending changes
        if (pendingQuoteChange) {
            clearTimeout(pendingQuoteChange);
        }
        
        // Store the current time
        const now = Date.now();
        
        // If we've recently processed a quote change, debounce this one
        if (now - lastQuoteChangeTime < debounceDelay) {
            debug.log('Debouncing quote change, too soon after previous change');
            
            // Set a timer to process this quote change after the debounce period
            pendingQuoteChange = setTimeout(() => {
                debug.log('Processing debounced quote change');
                lastQuoteChangeTime = Date.now();
                fadeOutWords(() => {
                    animateQuote(detail.quote, detail.emphasis || {});
                });
            }, debounceDelay);
        } else {
            // Process this quote change immediately
            lastQuoteChangeTime = now;
            fadeOutWords(() => {
                debug.log('Starting animation for new quote:', detail.quote);
                animateQuote(detail.quote, detail.emphasis || {});
            });
        }
    }
    
    // Setup event listeners
    function setupEventListeners() {
        debug.log('Setting up event listeners');
        
        // Audio control
        if (autoplayBtn) {
            autoplayBtn.addEventListener('click', toggleAudio);
            
            // Update button state when audio ends
            audioPlayer.addEventListener('ended', () => {
                // Audio might loop automatically, but we'll still handle the event
                if (!audioPlayer.loop) {
                    isPlaying = false;
                    updateAudioButton(false);
                    
                    // Stop auto-advancing if we're not looping
                    if (autoplayInterval) {
                        clearInterval(autoplayInterval);
                        autoplayInterval = null;
                    }
                }
            });
            
            // Handle audio loading errors
            audioPlayer.addEventListener('error', (e) => {
                debug.error('Audio error:', e);
                isPlaying = false;
                updateAudioButton(false);
                
                // Stop auto-advancing on error
                if (autoplayInterval) {
                    clearInterval(autoplayInterval);
                    autoplayInterval = null;
                }
            });
        }

        // Double-click to replay animation
        if (animatedTextContainer) {
            animatedTextContainer.addEventListener('dblclick', restartAnimation);
        }

        // Listen for quote changes with debounce
        document.addEventListener('quoteChanged', function(e) {
            debug.log('Received quoteChanged event:', e.detail);
            if (e.detail && e.detail.quote) {
                handleQuoteChange(e.detail);
            }
        });
        
        // Listen for window resize to adjust container height
        window.addEventListener('resize', adjustContainerHeight);
    }
    
    // Initialize the module
    function init() {
        debug.log('Initializing Animated Text module');
        if (!animatedTextContainer || !animatedText) {
            debug.error('Required elements not found!');
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
        toggleAudio: toggleAudio
    };
}); 