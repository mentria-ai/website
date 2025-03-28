// Quotes display functionality
class QuoteManager {
    constructor() {
        this.quotes = [];
        this.currentQuoteIndex = 0;
        this.debug = window.debug.createLogger('QuoteManager');
        this.mediaContainer = document.querySelector('.media-container');
        this.scrollContainer = document.querySelector('.scroll-container');
        this.progressFill = document.getElementById('progressFill');
        this.isScrolling = false;
        this.lastScrollTime = 0;
        this.scrollTimeout = null;
        this.resizeTimeout = null;
        
        // Configuration flag for whether to check for video versions
        this.checkForVideos = false; // Set to false by default - change to true if you want video support
        
        // Load the last viewed quote index from localStorage
        this.loadLastPosition();
        
        this.debug.log('QuoteManager initialized');
        
        this.init();
    }
    
    async init() {
        try {
            await this.loadQuotes();
            // Initialize the scroll container with images
            if (this.quotes.length > 0) {
                this.initializeScrollContainer();
                // Set initial quote details based on saved position
                this.updateQuoteInfo(this.currentQuoteIndex);
            }
            
            // Set up event listeners for scroll and other interactions
            this.setupEventListeners();
        } catch (error) {
            this.debug.error('Initialization error:', error);
        }
    }
    
    // Method to load the last viewed position
    loadLastPosition() {
        try {
            const savedIndex = localStorage.getItem('lastViewedQuoteIndex');
            if (savedIndex !== null) {
                this.currentQuoteIndex = parseInt(savedIndex, 10);
                this.debug.log('Loaded last position:', this.currentQuoteIndex);
            }
        } catch (error) {
            this.debug.error('Error loading last position:', error);
        }
    }
    
    // Method to save the current position
    savePosition() {
        try {
            localStorage.setItem('lastViewedQuoteIndex', this.currentQuoteIndex.toString());
            this.debug.log('Saved position:', this.currentQuoteIndex);
        } catch (error) {
            this.debug.error('Error saving position:', error);
        }
    }
    
    async loadQuotes() {
        try {
            const response = await fetch('assets/data/directory.json');
            if (!response.ok) {
                throw new Error(`Failed to fetch quotes: ${response.status}`);
            }
            
            const data = await response.json();
            this.quotes = data.quotes || [];
            
            // If saved index is out of bounds, reset to last item
            if (this.currentQuoteIndex >= this.quotes.length) {
                this.currentQuoteIndex = this.quotes.length - 1;
            }
            
            this.debug.log('Quotes loaded:', this.quotes.length);
            return this.quotes;
        } catch (error) {
            this.debug.error('Error loading quotes:', error);
            return [];
        }
    }
    
    initializeScrollContainer() {
        if (!this.scrollContainer || !this.quotes.length) {
            this.debug.error('Cannot initialize scroll container - missing elements or quotes');
            return;
        }
        
        this.debug.log('Initializing scroll container with', this.quotes.length, 'images');
        
        // Clear any existing content
        this.scrollContainer.innerHTML = '';
        
        // Add all images to the scroll container
        this.quotes.forEach((quote, index) => {
            this.addScrollItem(quote, index);
        });
        
        // Add extra items at the beginning and end for looping
        // Add the last few items to the beginning
        for (let i = Math.max(0, this.quotes.length - 3); i < this.quotes.length; i++) {
            this.addScrollItem(this.quotes[i], i, 'beginning', true);
        }
        
        // Add the first few items to the end
        for (let i = 0; i < Math.min(3, this.quotes.length); i++) {
            this.addScrollItem(this.quotes[i], i, 'end', true);
        }
        
        // Scroll to the saved position or first real item (after the clones)
        setTimeout(() => {
            const adjustedIndex = this.currentQuoteIndex + 3; // Adjust for clones
            const targetPosition = adjustedIndex * this.scrollContainer.clientHeight;
            this.scrollToPosition(targetPosition, false);
            this.debug.log('Scrolled to saved position:', this.currentQuoteIndex);
            
            // Ensure the visible video plays immediately
            const scrollItems = this.scrollContainer.querySelectorAll('.scroll-item');
            if (scrollItems.length > 0) {
                this.manageVideoPlayback(adjustedIndex, scrollItems);
            }
        }, 10);
    }
    
    addScrollItem(quote, index, position = 'end', isClone = false) {
        const imgSrc = quote.image_url || `assets/img/quotes/${quote.image || 'quote_1.jpg'}`;
        
        // Create container for snap point
        const scrollItem = document.createElement('div');
        scrollItem.className = 'scroll-item';
        scrollItem.dataset.index = index;
        if (isClone) {
            scrollItem.dataset.clone = 'true';
        }
        
        // Extract quote number for checking video
        let quoteNumber = null;
        const imgNameMatch = imgSrc.match(/quote_(\d+)\.png/);
        if (imgNameMatch && imgNameMatch[1]) {
            quoteNumber = imgNameMatch[1];
        }
        
        // Create image (will be replaced by video if one exists)
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = quote.alt || 'Motivational quote background';
        img.className = 'media-content';
        
        // Add to the scroll item
        scrollItem.appendChild(img);
        
        // Only check for video version if feature flag is enabled
        if (this.checkForVideos && quoteNumber) {
            const videoSrc = imgSrc.replace('.png', '.mp4');
            
            // Use fetch to check if the video exists (more reliable than video error events)
            fetch(videoSrc, { method: 'HEAD' })
                .then(response => {
                    if (response.ok) {
                        // Video exists, create and add it
                        const video = document.createElement('video');
                        video.src = videoSrc;
                        video.className = 'media-content';
                        video.autoplay = true;
                        video.loop = true;
                        video.muted = true;
                        video.playsInline = true;
                        video.controls = false;
                        
                        // Replace the image with the video
                        const existingMedia = scrollItem.querySelector('.media-content');
                        if (existingMedia) {
                            scrollItem.replaceChild(video, existingMedia);
                            
                            // Make sure video plays
                            video.play().catch(err => {
                                this.debug.error('Video autoplay failed:', err);
                                // We'll keep the video element, user may need to interact to play
                            });
                        }
                        
                        this.debug.log(`Using video for quote ${quoteNumber}: ${videoSrc}`);
                    } else {
                        this.debug.log(`No video found for quote ${quoteNumber}, using image`);
                    }
                })
                .catch(error => {
                    this.debug.error(`Error checking for video at ${videoSrc}:`, error);
                });
        }
        
        // Add to the beginning or end of the container
        if (position === 'beginning') {
            this.scrollContainer.prepend(scrollItem);
        } else {
            this.scrollContainer.appendChild(scrollItem);
        }
    }
    
    setupEventListeners() {
        this.debug.log('Setting up event listeners');
        
        if (!this.scrollContainer) {
            this.debug.error('Scroll container not found');
            return;
        }
        
        // Listen for resize events to adjust container size
        window.addEventListener('resize', this.handleResize.bind(this));
        
        // Listen for scroll events
        this.scrollContainer.addEventListener('scroll', () => {
            if (!this.isScrolling) {
                this.isScrolling = true;
                window.requestAnimationFrame(() => {
                    this.handleScroll();
                    this.isScrolling = false;
                });
            }
            
            this.lastScrollTime = Date.now();
            
            // Clear previous timeout
            if (this.scrollTimeout) {
                clearTimeout(this.scrollTimeout);
            }
            
            // Set new timeout
            this.scrollTimeout = setTimeout(() => {
                this.handleScrollEnd();
            }, 200);
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            this.debug.log('Key pressed:', { key: e.key });
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                this.prevQuote();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                this.nextQuote();
            }
        });
        
        // Add global navigation functions
        window.quoteNavigation = {
            next: this.nextQuote.bind(this),
            prev: this.prevQuote.bind(this)
        };
        
        // Add listener for user interaction to start videos (autoplay policy workaround)
        const userInteractionEvents = ['click', 'touchstart', 'keydown'];
        const playVideosOnUserInteraction = () => {
            // Find visible video and play it
            const visibleIndex = Math.round(this.scrollContainer.scrollTop / this.scrollContainer.clientHeight);
            const scrollItems = this.scrollContainer.querySelectorAll('.scroll-item');
            
            if (scrollItems.length > 0) {
                this.manageVideoPlayback(visibleIndex, scrollItems);
            }
            
            // Remove listeners after first interaction
            userInteractionEvents.forEach(event => {
                document.removeEventListener(event, playVideosOnUserInteraction);
            });
            
            this.debug.log('User interaction detected, attempting to play videos');
        };
        
        // Add the listeners
        userInteractionEvents.forEach(event => {
            document.addEventListener(event, playVideosOnUserInteraction, { once: false });
        });
    }
    
    handleScroll() {
        if (!this.scrollContainer) return;
        
        // Calculate which item is currently most visible
        const containerHeight = this.scrollContainer.clientHeight;
        const scrollPosition = this.scrollContainer.scrollTop;
        const visibleIndex = Math.round(scrollPosition / containerHeight);
        
        // Get all scroll items
        const scrollItems = this.scrollContainer.querySelectorAll('.scroll-item');
        if (!scrollItems.length) return;
        
        // Find the visible item
        if (visibleIndex < scrollItems.length) {
            const visibleItem = scrollItems[visibleIndex];
            const index = parseInt(visibleItem.dataset.index, 10);
            const isClone = visibleItem.dataset.clone === 'true';
            
            // Manage video playback - play the visible video, pause others
            this.manageVideoPlayback(visibleIndex, scrollItems);
            
            // Only update UI if we're showing a different quote than before
            if (index !== this.currentQuoteIndex) {
                this.currentQuoteIndex = index;
                this.updateQuoteInfo(index);
            }
            
            // If we've scrolled to a clone, we need to loop
            if (isClone) {
                // Wait until scroll animation completes
                clearTimeout(this.loopTimeout);
                this.loopTimeout = setTimeout(() => {
                    // If we're at the start clones, jump to the end
                    if (visibleIndex < 3) {
                        // Jump to the real items at the end
                        this.scrollToItem(index, false);
                    } 
                    // If we're at the end clones, jump to the start
                    else if (visibleIndex >= scrollItems.length - 3) {
                        // Jump to the real items at the start
                        this.scrollToItem(index, false);
                    }
                }, 300);
            }
        }
    }
    
    // Add new method to handle video playback based on visibility
    manageVideoPlayback(visibleIndex, scrollItems) {
        // Pause all videos first
        scrollItems.forEach((item, idx) => {
            const video = item.querySelector('video.media-content');
            if (video) {
                // If this is the visible item, play the video
                if (idx === visibleIndex) {
                    if (video.paused) {
                        video.play().catch(err => {
                            this.debug.error('Error playing video:', err);
                        });
                    }
                } else {
                    // Pause videos that aren't visible
                    if (!video.paused) {
                        video.pause();
                    }
                }
            }
        });
    }
    
    handleScrollEnd() {
        this.isScrolling = false;
        
        // Check if we need to snap to a different position
        const containerHeight = this.scrollContainer.clientHeight;
        const scrollPosition = this.scrollContainer.scrollTop;
        const targetPosition = Math.round(scrollPosition / containerHeight) * containerHeight;
        
        // Only scroll if we're not already at the target position
        if (Math.abs(scrollPosition - targetPosition) > 5) {
            this.scrollToPosition(targetPosition, true);
        }
    }
    
    updateQuoteInfo(index) {
        if (!this.quotes.length || index < 0 || index >= this.quotes.length) {
            this.debug.error('Invalid quote index:', index);
            return;
        }
        
        const quote = this.quotes[index];
        this.debug.log('Updating quote info:', { index, quote });
        
        // Save the current position when changing quotes
        this.currentQuoteIndex = index;
        this.savePosition();
        
        // Dispatch a custom event to notify that the quote has changed
        this.debug.log('Dispatching quoteChanged event with text:', quote.quote || quote.text);
        const quoteChangedEvent = new CustomEvent('quoteChanged', {
            detail: {
                quote: quote.quote || quote.text,
                emphasis: quote.emphasis || {},
                id: quote.id || `quote_${index}`,
                liked: this.isQuoteLiked(quote.id)
            }
        });
        
        document.dispatchEvent(quoteChangedEvent);
    }
    
    scrollToPosition(position, smooth = true) {
        if (!this.scrollContainer) return;
        
        this.isScrolling = true;
        
        if (smooth) {
            this.scrollContainer.scrollTo({
                top: position,
                behavior: 'smooth'
            });
        } else {
            this.scrollContainer.scrollTop = position;
        }
    }
    
    scrollToItem(index, smooth = true) {
        if (!this.scrollContainer) return;
        
        // Adjust index for the clones at the beginning
        const adjustedIndex = index + 3;
        const targetPosition = adjustedIndex * this.scrollContainer.clientHeight;
        this.scrollToPosition(targetPosition, smooth);
    }
    
    nextQuote() {
        const nextIndex = (this.currentQuoteIndex + 1) % this.quotes.length;
        this.debug.log('Moving to next quote:', { current: this.currentQuoteIndex, next: nextIndex });
        this.scrollToItem(nextIndex);
    }
    
    prevQuote() {
        const prevIndex = (this.currentQuoteIndex - 1 + this.quotes.length) % this.quotes.length;
        this.debug.log('Moving to previous quote:', { current: this.currentQuoteIndex, prev: prevIndex });
        this.scrollToItem(prevIndex);
    }
    
    isQuoteLiked(quoteId) {
        try {
            const likedQuotes = JSON.parse(localStorage.getItem('likedQuotes') || '[]');
            return likedQuotes.includes(quoteId);
        } catch (error) {
            this.debug.error('Error checking liked status:', error);
            return false;
        }
    }
    
    handleResize() {
        // Small delay to let the resize complete
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            // Recalculate position based on current index
            if (this.scrollContainer) {
                const currentItem = this.currentQuoteIndex + 3; // Adjust for clones
                const newPosition = currentItem * this.scrollContainer.clientHeight;
                this.scrollToPosition(newPosition, false);
            }
        }, 100);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const debug = window.debug.createLogger('QuoteManager');
    debug.log('DOM loaded, initializing QuoteManager');
    
    const quoteManager = new QuoteManager();
    
    // Expose navigation functions to window
    window.quoteNavigation = {
        next: () => quoteManager.nextQuote(),
        prev: () => quoteManager.prevQuote()
    };
    
    debug.log('Navigation functions exposed to window.quoteNavigation');
}); 