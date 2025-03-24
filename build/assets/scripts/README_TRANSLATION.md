# Mahabharata Translation Script

This script translates the Sanskrit Mahabharata text to English using the Anthropic Claude API.

## Prerequisites

1. Python 3.7+ installed
2. Required Python packages:
   - `anthropic`
   - `python-dotenv`

## Setup

1. Ensure you have an Anthropic API key stored in your `.env` file:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```

2. Install required dependencies:
   ```bash
   pip install anthropic python-dotenv
   ```

3. Make sure the source file `build/assets/data/reference/mahabharata.txt` exists

## Usage

Run the script from the command line:

```bash
python translate_mahabharata.py
```

## How it Works

The script:

1. Processes the Mahabharata text in batches of 10 lines
2. For each batch:
   - Includes previous translations as context (50 lines)
   - Includes upcoming Sanskrit text as context (50 lines)
   - Translates with Claude 3.7 Sonnet
   - Appends results to the output file
3. Creates a markdown table with Sanskrit text and English translations
4. Continues until the entire text is processed

## Output

The translated text is saved to `build/assets/data/mahabharat_translated.txt` in this format:

| **Sanskrit** | **English Translation** |
|-------------|-------------------------|
| `Line X: [Sanskrit text]` | "[English translation with cultural context]" |

## Notes

- The script includes rate limiting (3 seconds between API calls) to avoid API rate limits
- Error handling is included for API failures
- The temperature is set to 0.2 for accurate translations

## Customization

You can adjust these parameters in the script:
- `BATCH_SIZE`: Number of lines to translate per API call
- `CONTEXT_BEFORE`: Number of previously translated lines to include as context
- `CONTEXT_AFTER`: Number of upcoming Sanskrit lines to include as context
- `DELAY_BETWEEN_REQUESTS`: Seconds to wait between API calls 