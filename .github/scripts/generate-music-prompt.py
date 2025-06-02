#!/usr/bin/env python3
"""
Generate AI prompt for music generation
"""
import sys
import os
from datetime import datetime

def generate_prompt(custom_theme=None, custom_seed=None):
    """Generate the music generation prompt"""
    current_time = datetime.now().strftime("%H:%M")
    current_date = datetime.now().strftime("%A, %B %d, %Y")
    
    prompt_parts = [
        "You are an AI music production specialist with deep expertise in ACE-Step. Generate creative music parameters optimized for ACE-Step's capabilities.",
        "",
        "**Current Context:**",
        f"- Current time: {current_time}",
        f"- Current date: {current_date}",
        "- Target system: ACE-Step AI music generation",
        "",
        "**1. Style Prompt:** Create 4-8 comma-separated, lowercase tags covering genre, mood, instruments, production style.",
        'Examples: "electronic, ambient, ethereal, synthesizer" or "folk, acoustic, storytelling, guitar"',
        "",
        "**2. Lyrics:** Create COMPLETE song structure with multiple sections:",
        "- For songs with vocals: Include [verse], [chorus], [bridge], [outro] with full lyrics",
        "- For instrumentals: Use [inst] only",
        "- Example structure: [verse] content here [chorus] content here [verse] more content [chorus] repeat [bridge] bridge content [outro] ending",
        "- Write actual lyrical content, not just section markers",
        "",
        "**3. Duration:** Choose from 30, 45, 60, 90, 120, 150, 180, or 240 seconds based on content scope.",
        "",
        "**4. Title:** Generate UNIQUE, creative titles with variety. Avoid repetitive patterns like 'Neon [Word]' or '[Adjective] Dawn'.",
        "- Use unexpected word combinations, metaphors, or cultural references",
        "- Consider time of day, emotions, places, objects, or abstract concepts",
        "- Examples: 'Digital Butterflies', 'Midnight Coffee Shop', 'Paper Airplane Dreams', 'Velvet Thunder'",
        "",
        "**5. Inspiration:** Brief explanation of creative choices and influences.",
        "",
        "**Output Format (JSON only):**",
        "{",
        '  "style_prompt": "comma-separated, lowercase tags",',
        '  "lyrics": "[verse] actual verse lyrics here [chorus] actual chorus lyrics here [verse] more verse lyrics [chorus] repeat chorus [bridge] bridge lyrics [outro] ending lyrics",',
        '  "duration": number (30-240),',
        '  "title_suggestion": "unique creative title",',
        '  "inspiration": "brief explanation",',
        '  "seed": number (0-4294967295, optional - only if requested)',
        "}",
        "",
        "**Quality Standards:** All content must be original, culturally sensitive, and radio-appropriate.",
        "**Diversity Goals:** Explore different genres, cultures, and emotional ranges. Avoid repetitive themes.",
        "**Variety Requirements:**",
        "- Vary title patterns (avoid 'Neon X', 'Digital X', 'Midnight X' repetition)",
        "- Mix instrumental and vocal pieces randomly",
        "- Explore different time periods, moods, and cultural influences",
        "- Create unexpected genre combinations",
        "",
        "Generate something musically compelling, unique, and ACE-Step optimized now:"
    ]
    
    # Add custom theme if provided
    if custom_theme:
        prompt_parts.extend([
            "",
            f"**Special Theme Request:** Focus on or incorporate elements of: {custom_theme}"
        ])
    
    # Add seed information if provided
    if custom_seed:
        prompt_parts.extend([
            "",
            f"**Seed Requirement:** The user has specified seed {custom_seed} for reproducible generation. Include this exact seed value in your response."
        ])
    
    return "\n".join(prompt_parts)

def main():
    """Main function"""
    custom_theme = os.getenv('CUSTOM_THEME', '').strip()
    custom_seed = os.getenv('CUSTOM_SEED', '').strip()
    
    prompt = generate_prompt(
        custom_theme=custom_theme if custom_theme else None,
        custom_seed=custom_seed if custom_seed else None
    )
    
    # Write prompt to file
    with open('music_generation_prompt.txt', 'w', encoding='utf-8') as f:
        f.write(prompt)
    
    print("✅ Music generation prompt created successfully")

if __name__ == "__main__":
    main() 