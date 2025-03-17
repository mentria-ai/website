# Motivational Quotes Generator with Ghibli Art Style

This project generates motivational quotes with accompanying image prompts in the Ghibli Art style, displays them in an Instagram Reel-like UI, and allows for easy navigation between quotes.

## Features

- **Python Script for Quote Generation**: Generates motivational quotes and image prompts using DeepSeek-V3 AI
- **Image Generation**: Creates images based on the prompts using FLUX.1-dev-lora with Ghibli Art style
- **Instagram Reel-like UI**: Displays quotes and images in a modern, mobile-friendly interface
- **Animated Subtitles**: Displays quotes as animated subtitles with word-by-word animation and highlighted keywords
- **Navigation**: Swipe or use arrow keys to navigate between quotes
- **Caption Truncation**: Long quotes are truncated with a "more/less" toggle
- **Responsive Design**: Works on both desktop and mobile devices

## Setup

1. Install required Python packages:
   ```
   pip install python-dotenv together
   ```

2. Set up your API key:
   - Create a `.env` file in the project root
   - Add your Together API key: `TOGETHER_API_KEY=your_api_key_here`

3. Create necessary directories:
   ```
   mkdir -p build/assets/img/quotes
   ```

## Usage

### Generating Quotes

Run the quote generator script to create new quotes and images:

```
python build/quote_generator.py
```

This will:
1. Load existing quotes from `build/directory.json` (if it exists)
2. Generate new motivational quotes and image prompts using DeepSeek-V3
3. Create images for each quote using the FLUX.1-dev-lora model with Ghibli Art style
4. Save everything to `build/directory.json`

### Viewing Quotes

Open `build/index.html` in a web browser to view the quotes in the Instagram Reel-like UI.

- Swipe up/down or use arrow keys to navigate between quotes
- Click the "more" button to expand long quotes
- Double-tap the image to "like" it
- Use the closed captioning button to toggle animated subtitles on/off
- Double-click on the subtitles area to replay the animation
- Press 'C' key to toggle subtitles on/off
- Press 'R' key to toggle auto-replay of subtitles

## File Structure

- `build/quote_generator.py`: Python script for generating quotes and images
- `build/directory.json`: JSON file containing all quotes and image information
- `build/index.html`: Main HTML file for the Instagram Reel-like UI
- `build/assets/css/styles.css`: CSS styles for the UI
- `build/assets/js/main.js`: Main JavaScript file for UI functionality
- `build/assets/js/quotes.js`: JavaScript file for loading and displaying quotes
- `build/assets/img/quotes/`: Directory containing generated images

## Customization

- Modify the system and user prompts in `quote_generator.py` to change the style of quotes and image prompts
- Adjust the image generation parameters in `quote_generator.py` to change the image style
- Edit the CSS in `styles.css` to customize the UI appearance

## Notes

- The script saves progress after each successful image generation, so if it's interrupted, you won't lose all your work
- In development mode (localhost), short quotes are artificially extended to test the truncation feature
- The UI includes navigation buttons and keyboard shortcuts for easy browsing

## License

MIT 