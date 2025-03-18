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
        
        // Create image
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = quote.alt || 'Motivational quote background';
        img.className = 'media-content';
        
        // Add to the scroll item
        scrollItem.appendChild(img);
        
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
        
        // Listen for scroll events to track the current quote
        this.scrollContainer.addEventListener('scroll', () => {
            // Throttle scroll events
            const now = Date.now();
            if (now - this.lastScrollTime > 100) { // Process scroll every 100ms
                this.lastScrollTime = now;
                this.handleScroll();
            }
            
            // Reset the scroll timeout
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => this.handleScrollEnd(), 150);
        });
        
        // Handle window resize to maintain correct scroll positions
        window.addEventListener('resize', () => {
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