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
        
        // Add navigation lock to prevent rapid changes
        this.isNavigating = false;
        this.navigationTimeout = null;
        this.pendingNavigation = null;
        this.navigationDebounceDelay = 800; // ms
        this.lastNavigationTime = 0;
        
        // Image prefetching and loading state
        this.prefetchedImages = new Set();
        this.loadingImages = new Map();
        this.isPrefetchingActive = true;
        this.prefetchDistance = 2; // Prefetch 2 slides ahead and behind
        
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
                
                // Start prefetching adjacent slides
                this.prefetchAdjacentImages(this.currentQuoteIndex);
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
    
    // Prefetch images for slides adjacent to current index
    prefetchAdjacentImages(currentIndex) {
        if (!this.isPrefetchingActive || !this.quotes.length) return;
        
        const quoteCount = this.quotes.length;
        
        // Prefetch slides ahead and behind within prefetchDistance
        for (let offset = -this.prefetchDistance; offset <= this.prefetchDistance; offset++) {
            if (offset === 0) continue; // Skip current slide
            
            const slideIndex = (currentIndex + offset + quoteCount) % quoteCount;
            const quote = this.quotes[slideIndex];
            
            if (quote) {
                const imgSrc = quote.image_url || `assets/img/quotes/${quote.image || 'quote_1.jpg'}`;
                this.prefetchImage(imgSrc, slideIndex);
            }
        }
    }
    
    // Prefetch a single image
    prefetchImage(imgSrc, indexForLogging) {
        // Skip if already prefetched or currently loading
        if (this.prefetchedImages.has(imgSrc) || this.loadingImages.has(imgSrc)) {
            return;
        }
        
        // Create an image element for prefetching
        const img = new Image();
        
        // Track the loading state
        this.loadingImages.set(imgSrc, img);
        
        // Set up event listeners
        img.onload = () => {
            this.debug.log(`Prefetched image for slide ${indexForLogging}: ${imgSrc}`);
            this.prefetchedImages.add(imgSrc);
            this.loadingImages.delete(imgSrc);
        };
        
        img.onerror = () => {
            this.debug.error(`Failed to prefetch image for slide ${indexForLogging}: ${imgSrc}`);
            this.loadingImages.delete(imgSrc);
        };
        
        // Start the prefetch
        img.src = imgSrc;
    }
    
    // Check if an image is ready (either prefetched or already in cache)
    isImageReady(imgSrc) {
        return this.prefetchedImages.has(imgSrc) || 
               !this.loadingImages.has(imgSrc);
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
        
        // Create image container with loading state
        const imgContainer = document.createElement('div');
        imgContainer.className = 'media-content-container';
        
        // Optional loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'loading-indicator';
        loadingIndicator.innerHTML = '<div class="spinner"></div>';
        loadingIndicator.style.display = 'none'; // Hide initially
        imgContainer.appendChild(loadingIndicator);
        
        // Create image (will be replaced by video if one exists)
        const img = document.createElement('img');
        img.className = 'media-content';
        img.alt = quote.alt || 'Motivational quote background';
        
        // Handle loading state
        if (!this.isImageReady(imgSrc)) {
            loadingIndicator.style.display = 'flex'; // Show loading indicator
            img.style.opacity = '0'; // Hide image until loaded
            
            // Set up load event
            img.onload = () => {
                loadingIndicator.style.display = 'none';
                img.style.opacity = '1';
                this.prefetchedImages.add(imgSrc);
                
                // Check if we need to update scroll position
                if (index === this.currentQuoteIndex) {
                    // If this is the current slide and it just loaded, ensure it's visible
                    this.scrollToItem(index, false);
                }
            };
            
            img.onerror = () => {
                loadingIndicator.innerHTML = '<div class="error-message">Image failed to load</div>';
                this.debug.error(`Failed to load image: ${imgSrc}`);
            };
        }
        
        // Set the src after setting up event handlers
        img.src = imgSrc;
        imgContainer.appendChild(img);
        
        // Add the image container to the scroll item
        scrollItem.appendChild(imgContainer);
        
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
                        const existingMedia = imgContainer.querySelector('.media-content');
                        if (existingMedia) {
                            imgContainer.replaceChild(video, existingMedia);
                            
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
                this.debug.log('Scroll detected new quote:', { old: this.currentQuoteIndex, new: index });
                this.currentQuoteIndex = index;
                
                // Force event dispatch regardless of isNavigating state
                this.updateQuoteInfo(index);
                
                // Start prefetching adjacent images from the new position
                this.prefetchAdjacentImages(index);
                
                // Ensure navigation lock is released appropriately
                if (this.isNavigating) {
                    // Clear any existing timeout to prevent race conditions
                    if (this.navigationTimeout) {
                        clearTimeout(this.navigationTimeout);
                    }
                    
                    // Set a short timeout to release the lock
                    this.navigationTimeout = setTimeout(() => {
                        this.debug.log('Navigation lock released after scroll completion');
                        this.isNavigating = false;
                        
                        // Re-dispatch the quote change event to ensure it's processed
                        if (this.quotes[index]) {
                            const quote = this.quotes[index];
                            const reUpdateEvent = new CustomEvent('quoteChanged', {
                                detail: {
                                    quote: quote.quote || quote.text,
                                    emphasis: quote.emphasis || {},
                                    id: quote.id || `quote_${index}`,
                                    liked: this.isQuoteLiked(quote.id),
                                    forceUpdate: true // Add flag to force update
                                }
                            });
                            this.debug.log('Re-dispatching quote change event for', quote.id || `quote_${index}`);
                            document.dispatchEvent(reUpdateEvent);
                        }
                        
                        // Process any pending navigation
                        if (this.pendingNavigation) {
                            const navDirection = this.pendingNavigation;
                            this.pendingNavigation = null;
                            this.debug.log('Processing pending navigation:', navDirection);
                            
                            setTimeout(() => {
                                if (navDirection === 'next') {
                                    this.nextQuote();
                                } else if (navDirection === 'prev') {
                                    this.prevQuote();
                                }
                            }, 50);
                        }
                    }, 100); // Shorter timeout for better responsiveness
                }
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
        this.debug.log('Updating quote info:', { index, quote: quote.id || `quote_${index}` });
        
        // Save the current position when changing quotes
        this.currentQuoteIndex = index;
        this.savePosition();
        
        // Enhanced debugging info
        this.debug.log('Dispatching quoteChanged event:', { 
            id: quote.id || `quote_${index}`,
            textLength: (quote.quote || quote.text || '').length,
            timeSinceLastNav: Date.now() - this.lastNavigationTime,
            isNavigating: this.isNavigating
        });
        
        // Dispatch a custom event to notify that the quote has changed
        const quoteChangedEvent = new CustomEvent('quoteChanged', {
            detail: {
                quote: quote.quote || quote.text,
                emphasis: quote.emphasis || {},
                id: quote.id || `quote_${index}`,
                liked: this.isQuoteLiked(quote.id),
                scrollInitiated: true // Flag to indicate this was from scroll
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
        // If already navigating, store this as pending and return
        if (this.isNavigating) {
            this.debug.log('Next navigation requested while busy - queuing');
            this.pendingNavigation = 'next';
            return;
        }
        
        const nextIndex = (this.currentQuoteIndex + 1) % this.quotes.length;
        
        // Check if the next image is ready before navigating
        const nextQuote = this.quotes[nextIndex];
        if (nextQuote) {
            const imgSrc = nextQuote.image_url || `assets/img/quotes/${nextQuote.image || 'quote_1.jpg'}`;
            
            // If image is still loading, prefetch it and show loading state
            if (!this.isImageReady(imgSrc)) {
                this.debug.log(`Next image not ready, prefetching: ${imgSrc}`);
                this.prefetchImage(imgSrc, nextIndex);
                
                // Still proceed with navigation, but with a visual loading indicator
                const scrollItems = this.scrollContainer.querySelectorAll('.scroll-item');
                const nextAdjustedIndex = nextIndex + 3; // Adjust for clones
                
                if (scrollItems[nextAdjustedIndex]) {
                    const loadingIndicator = scrollItems[nextAdjustedIndex].querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        loadingIndicator.style.display = 'flex';
                    }
                }
            }
        }
        
        // Set navigation lock
        this.setNavigationLock();
        
        this.debug.log('Moving to next quote:', { current: this.currentQuoteIndex, next: nextIndex });
        
        // Immediately update quote info before scrolling
        this.updateQuoteInfo(nextIndex);
        
        // Then scroll to the item
        this.scrollToItem(nextIndex);
        
        // Start prefetching for the new position
        this.prefetchAdjacentImages(nextIndex);
    }
    
    prevQuote() {
        // If already navigating, store this as pending and return
        if (this.isNavigating) {
            this.debug.log('Previous navigation requested while busy - queuing');
            this.pendingNavigation = 'prev';
            return;
        }
        
        const prevIndex = (this.currentQuoteIndex - 1 + this.quotes.length) % this.quotes.length;
        
        // Check if the previous image is ready before navigating
        const prevQuote = this.quotes[prevIndex];
        if (prevQuote) {
            const imgSrc = prevQuote.image_url || `assets/img/quotes/${prevQuote.image || 'quote_1.jpg'}`;
            
            // If image is still loading, prefetch it and show loading state
            if (!this.isImageReady(imgSrc)) {
                this.debug.log(`Previous image not ready, prefetching: ${imgSrc}`);
                this.prefetchImage(imgSrc, prevIndex);
                
                // Still proceed with navigation, but with a visual loading indicator
                const scrollItems = this.scrollContainer.querySelectorAll('.scroll-item');
                const prevAdjustedIndex = prevIndex + 3; // Adjust for clones
                
                if (scrollItems[prevAdjustedIndex]) {
                    const loadingIndicator = scrollItems[prevAdjustedIndex].querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        loadingIndicator.style.display = 'flex';
                    }
                }
            }
        }
        
        // Set navigation lock
        this.setNavigationLock();
        
        this.debug.log('Moving to previous quote:', { current: this.currentQuoteIndex, prev: prevIndex });
        
        // Immediately update quote info before scrolling
        this.updateQuoteInfo(prevIndex);
        
        // Then scroll to the item
        this.scrollToItem(prevIndex);
        
        // Start prefetching for the new position
        this.prefetchAdjacentImages(prevIndex);
    }
    
    // Add method to set navigation lock
    setNavigationLock() {
        this.isNavigating = true;
        this.lastNavigationTime = Date.now();
        
        // Clear any existing timeout
        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
        }
        
        // Set timeout to release the lock
        this.navigationTimeout = setTimeout(() => {
            this.debug.log('Navigation lock released');
            this.isNavigating = false;
            
            // Re-dispatch the current quote info to ensure everything is in sync
            const currentIndex = this.currentQuoteIndex;
            if (this.quotes[currentIndex]) {
                const quote = this.quotes[currentIndex];
                const syncEvent = new CustomEvent('quoteChanged', {
                    detail: {
                        quote: quote.quote || quote.text,
                        emphasis: quote.emphasis || {},
                        id: quote.id || `quote_${currentIndex}`,
                        liked: this.isQuoteLiked(quote.id),
                        forceUpdate: true // Force update to ensure sync
                    }
                });
                this.debug.log('Dispatching sync event for', quote.id || `quote_${currentIndex}`);
                document.dispatchEvent(syncEvent);
            }
            
            // Check for pending navigation
            if (this.pendingNavigation) {
                this.debug.log('Processing pending navigation:', this.pendingNavigation);
                const navDirection = this.pendingNavigation;
                this.pendingNavigation = null;
                
                // Small delay before executing pending navigation
                setTimeout(() => {
                    if (navDirection === 'next') {
                        this.nextQuote();
                    } else if (navDirection === 'prev') {
                        this.prevQuote();
                    }
                }, 50);
            }
        }, this.navigationDebounceDelay);
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
    
    // Make sure we initialize the QuoteManager first
    // Wait for a short delay to ensure everything is registered properly
    setTimeout(() => {
        // Expose navigation functions to window
        window.quoteNavigation = {
            next: () => quoteManager.nextQuote(),
            prev: () => quoteManager.prevQuote(),
            isNavigating: () => quoteManager.isNavigating
        };
        
        debug.log('Navigation functions exposed to window.quoteNavigation');
        
        // Force a sync after everything is initialized
        if (quoteManager.quotes.length > 0) {
            const currentIndex = quoteManager.currentQuoteIndex;
            if (quoteManager.quotes[currentIndex]) {
                debug.log('Forcing initial sync for quote:', currentIndex);
                const quote = quoteManager.quotes[currentIndex];
                const syncEvent = new CustomEvent('quoteChanged', {
                    detail: {
                        quote: quote.quote || quote.text,
                        emphasis: quote.emphasis || {},
                        id: quote.id || `quote_${currentIndex}`,
                        liked: quoteManager.isQuoteLiked(quote.id),
                        forceUpdate: true
                    }
                });
                document.dispatchEvent(syncEvent);
            }
        }
    }, 500);
}); 