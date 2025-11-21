// Tests for Instagram Reel UI
(function() {
    // Run tests when DOM is fully loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Running UI tests...');
        
        // Test results container
        const testResults = {
            passed: 0,
            failed: 0,
            total: 0
        };
        
        // Test function
        function test(name, testFn) {
            testResults.total++;
            try {
                const result = testFn();
                if (result) {
                    console.log(`✅ PASS: ${name}`);
                    testResults.passed++;
                } else {
                    console.error(`❌ FAIL: ${name}`);
                    testResults.failed++;
                }
            } catch (error) {
                console.error(`❌ ERROR: ${name}`, error);
                testResults.failed++;
            }
        }
        
        // UI Structure Tests
        test('Reel container exists', () => {
            return document.querySelector('.reel-container') !== null;
        });
        
        test('Media container exists', () => {
            return document.querySelector('.media-container') !== null;
        });
        
        test('Media content (image) exists', () => {
            return document.querySelector('.media-content') !== null;
        });
        
        test('Progress bar exists', () => {
            return document.querySelector('.progress-bar') !== null;
        });
        
        test('Controls exist', () => {
            return document.querySelector('.reel-controls') !== null;
        });
        
        test('Bottom controls container exists', () => {
            return document.querySelector('.bottom-controls-container') !== null;
        });
        
        test('Caption exists', () => {
            return document.querySelector('.caption') !== null;
        });
        
        test('Caption toggle button exists', () => {
            return document.querySelector('.caption-toggle') !== null;
        });
        
        test('Username element does not exist', () => {
            return document.querySelector('.username') === null;
        });
        
        test('Controls and caption are in the same container', () => {
            const bottomContainer = document.querySelector('.bottom-controls-container');
            const controls = document.querySelector('.reel-controls');
            const reelInfo = document.querySelector('.reel-info');
            return bottomContainer.contains(controls) && bottomContainer.contains(reelInfo);
        });
        
        test('Progress bar is inside media container', () => {
            const mediaContainer = document.querySelector('.media-container');
            const progressContainer = document.querySelector('.progress-container');
            return mediaContainer.contains(progressContainer);
        });
        
        // Responsive Design Tests
        test('Viewport meta tag exists', () => {
            const metaViewport = document.querySelector('meta[name="viewport"]');
            return metaViewport !== null && metaViewport.getAttribute('content').includes('width=device-width');
        });
        
        test('Media container has correct aspect ratio on desktop', () => {
            if (window.innerWidth >= 769) {
                const mediaContainer = document.querySelector('.media-container');
                const style = window.getComputedStyle(mediaContainer);
                const width = parseFloat(style.width);
                const height = parseFloat(style.height);
                
                // Allow for small rounding errors
                const aspectRatio = width / height;
                return Math.abs(aspectRatio - (9/16)) < 0.1;
            }
            return true; // Skip on mobile
        });
        
        // Caption Truncation Tests
        test('Caption has truncation elements', () => {
            const captionText = document.querySelector('.caption-text');
            const captionTruncated = document.querySelector('.caption-truncated');
            const captionToggle = document.querySelector('.caption-toggle');
            return captionText !== null && captionTruncated !== null && captionToggle !== null;
        });
        
        // Accessibility Tests
        test('Image has alt text', () => {
            const img = document.querySelector('.media-content');
            return img && img.hasAttribute('alt') && img.getAttribute('alt').trim() !== '';
        });
        
        test('Interactive elements are keyboard accessible', () => {
            const interactiveElements = document.querySelectorAll('.control-icon');
            return Array.from(interactiveElements).every(el => {
                // Should be focusable
                return el.tabIndex >= 0 || el.tagName === 'BUTTON' || el.tagName === 'A';
            });
        });
        
        test('Caption toggle has aria-label', () => {
            const captionToggle = document.querySelector('.caption-toggle');
            return captionToggle && captionToggle.hasAttribute('aria-label');
        });
        
        // Performance Tests
        test('No inline styles on main elements', () => {
            const mainElements = document.querySelectorAll('.reel-container, .media-container, .bottom-controls-container');
            return Array.from(mainElements).every(el => !el.hasAttribute('style'));
        });
        
        test('External resources have correct loading attributes', () => {
            const scripts = document.querySelectorAll('script[src]');
            const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
            
            // Check if scripts at the end of body
            const scriptsAtEnd = Array.from(scripts).every(script => {
                const parentNode = script.parentNode;
                return parentNode.tagName === 'BODY' && 
                       Array.from(parentNode.children).indexOf(script) >= parentNode.children.length - 3;
            });
            
            // Check if stylesheets in head
            const stylesheetsInHead = Array.from(stylesheets).every(link => {
                return link.parentNode.tagName === 'HEAD';
            });
            
            return scriptsAtEnd && stylesheetsInHead;
        });
        
        // Best Practices Tests
        test('HTML has correct doctype', () => {
            return document.doctype && 
                   document.doctype.name.toLowerCase() === 'html';
        });
        
        test('HTML has lang attribute', () => {
            return document.documentElement.hasAttribute('lang');
        });
        
        test('Page has title', () => {
            return document.title && document.title.trim() !== '';
        });
        
        // Functionality Tests
        test('Like button toggles state', () => {
            const likeBtn = document.getElementById('likeBtn');
            const heartIcon = likeBtn.querySelector('i');
            const initialClass = heartIcon.className;
            
            // Simulate click
            likeBtn.click();
            const afterClickClass = heartIcon.className;
            
            // Restore state
            likeBtn.click();
            
            return initialClass !== afterClickClass;
        });
        
        // Log test summary
        console.log(`Tests completed: ${testResults.total} total, ${testResults.passed} passed, ${testResults.failed} failed`);
        
        // Create visual test report if in development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            createVisualTestReport(testResults);
        }
    });
    
    // Create visual test report
    function createVisualTestReport(results) {
        const reportContainer = document.createElement('div');
        reportContainer.style.position = 'fixed';
        reportContainer.style.bottom = '20px';
        reportContainer.style.right = '20px';
        reportContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        reportContainer.style.color = '#fff';
        reportContainer.style.padding = '15px';
        reportContainer.style.borderRadius = '5px';
        reportContainer.style.zIndex = '9999';
        reportContainer.style.fontSize = '14px';
        reportContainer.style.fontFamily = 'monospace';
        
        reportContainer.innerHTML = `
            <div style="margin-bottom: 10px; font-weight: bold;">UI Test Results</div>
            <div>Total: ${results.total}</div>
            <div style="color: #4CAF50;">Passed: ${results.passed}</div>
            <div style="color: ${results.failed > 0 ? '#F44336' : '#4CAF50'};">Failed: ${results.failed}</div>
            <button id="closeTestReport" style="margin-top: 10px; padding: 5px 10px; background: #333; color: #fff; border: none; border-radius: 3px; cursor: pointer;">Close</button>
        `;
        
        document.body.appendChild(reportContainer);
        
        document.getElementById('closeTestReport').addEventListener('click', function() {
            document.body.removeChild(reportContainer);
        });
    }
})(); 