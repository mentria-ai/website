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
            likeMedia();
            
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
    likeBtn.addEventListener('click', likeMedia);
    
    function likeMedia() {
        const heartIcon = likeBtn.querySelector('i');
        
        if (heartIcon.classList.contains('far')) {
            // Like
            heartIcon.classList.remove('far');
            heartIcon.classList.add('fas', 'liked');
        } else {
            // Unlike
            heartIcon.classList.remove('fas', 'liked');
            heartIcon.classList.add('far');
        }
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
}); 