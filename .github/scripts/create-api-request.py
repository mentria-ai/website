#!/usr/bin/env python3
"""
Create API request payload for Together AI
"""
import json
import sys

def create_api_request():
    """Create API request payload"""
    try:
        # Read the prompt from file
        with open('music_generation_prompt.txt', 'r', encoding='utf-8') as f:
            prompt_content = f.read()
        
        # Create the API request payload
        payload = {
            'model': 'deepseek-ai/DeepSeek-V3',
            'messages': [{'role': 'user', 'content': prompt_content}],
            'max_tokens': 1000,
            'temperature': 0.8
        }
        
        # Write to file
        with open('api_request.json', 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)
        
        print("✅ API request payload created successfully")
        return True
        
    except Exception as e:
        print(f"❌ Error creating API request: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    success = create_api_request()
    sys.exit(0 if success else 1) 