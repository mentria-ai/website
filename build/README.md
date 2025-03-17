# Instagram Reel-like UI

A responsive and interactive Instagram Reel-like UI implementation using HTML, CSS, and JavaScript.

## Features

- **9:16 Aspect Ratio**: Maintains the standard Instagram Reel aspect ratio on desktop
- **Full-Screen Mobile Experience**: Edge-to-edge display on mobile devices
- **Self-Contained UI**: All controls, captions, and progress indicators are contained within the media box
- **Interactive Elements**:
  - Double-tap to like with animation
  - Like button toggle
  - Swipe navigation (up/down)
  - Keyboard navigation (arrow keys)
- **Smart Caption Handling**: Captions longer than 20 words are truncated with a "more/less" toggle
- **Aligned Controls**: Action buttons are aligned with the caption baseline for a clean look
- **Responsive Design**: Adapts to different screen sizes while maintaining aspect ratio
- **Accessibility Features**: Proper ARIA roles, keyboard navigation, and focus states
- **Loading States**: Visual indicator while content loads
- **Progress Bar**: Visual indicator of reel duration/progress
- **Smooth Animations**: For interactions and transitions

## Implementation Details

### HTML Structure

The UI is structured with semantic HTML elements:

- Main container with proper aspect ratio
- Media container that houses all UI elements:
  - The media content (image/video)
  - Bottom controls container with caption and action buttons
  - Progress indicator at the top
  - Gradient overlay for text visibility

### CSS Features

- Flexbox layout for responsive positioning
- CSS variables for consistent theming
- Media queries for responsive design
- Smooth transitions and animations
- Gradient overlays for better text visibility

### JavaScript Functionality

- Double-tap/click detection for liking
- Swipe detection for navigation
- Dynamic aspect ratio calculation
- Loading state management
- Interactive controls

## Testing

The UI includes a comprehensive test suite that checks:

- UI structure and components
- Responsive design implementation
- Accessibility features
- Performance best practices
- HTML/CSS/JS best practices
- Interactive functionality

Tests run automatically in development environments and display results in a floating panel.

## Browser Compatibility

Tested and working in:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Android Chrome)

## Usage

1. Clone the repository
2. Open `index.html` in a browser
3. Interact with the UI using mouse, touch, or keyboard

## Development

To run tests:
1. Open the page in a local development server
2. Tests will run automatically and display results
3. Check the console for detailed test output

## License

MIT 