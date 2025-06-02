#!/usr/bin/env python3
"""
Generate AI prompt for music generation
"""
import sys
import os
import random
from datetime import datetime

def generate_prompt(custom_theme=None, custom_seed=None):
    """Generate the music generation prompt"""
    current_time = datetime.now().strftime("%H:%M")
    current_date = datetime.now().strftime("%A, %B %d, %Y")
    
    # Determine seed for odd/even logic
    if custom_seed:
        try:
            seed_value = int(custom_seed)
        except:
            seed_value = random.randint(1, 4294967295)
    else:
        seed_value = random.randint(1, 4294967295)
    
    # Determine if instrumental or vocal based on seed parity
    is_instrumental = (seed_value % 2 == 1)  # Odd = instrumental, Even = vocal
    
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
        f"**2. Lyrics:** {'INSTRUMENTAL TRACK - Use [inst] only' if is_instrumental else 'VOCAL TRACK - Create COMPLETE song structure with multiple sections'}",
        *([
            "- This should be an instrumental piece, so use [inst] only",
            "- Focus on melody, rhythm, and instrumental arrangement"
        ] if is_instrumental else [
            "- Include [verse], [chorus], [bridge], [outro] with full lyrics",
            "- Example structure: [verse] content here [chorus] content here [verse] more content [chorus] repeat [bridge] bridge content [outro] ending",
            "- Write actual lyrical content, not just section markers",
            "- Create meaningful, cohesive lyrics that tell a story or convey emotion"
        ]),
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
        f'  "lyrics": "{"[inst]" if is_instrumental else "[verse] actual verse lyrics here [chorus] actual chorus lyrics here [verse] more verse lyrics [chorus] repeat chorus [bridge] bridge lyrics [outro] ending lyrics"}",',
        '  "duration": number (30-240),',
        '  "title_suggestion": "unique creative title",',
        '  "inspiration": "brief explanation",',
        f'  "seed": {seed_value}',
        "}",
        "",
        "**Quality Standards:** All content must be original, culturally sensitive, and radio-appropriate.",
        "**Diversity Goals:** Explore different genres, cultures, and emotional ranges. Avoid repetitive themes.",
        "**Variety Requirements:**",
        "- Vary title patterns (avoid 'Neon X', 'Digital X', 'Midnight X' repetition)",
        "- Explore different time periods, moods, and cultural influences", 
        "- Create unexpected genre combinations",
        "",
        f"**Current Generation Mode: {'INSTRUMENTAL' if is_instrumental else 'VOCAL'} (Seed {seed_value} - {'Odd' if is_instrumental else 'Even'})**",
        f"{'Focus on creating an engaging instrumental piece with rich melodies and arrangements.' if is_instrumental else 'Create compelling vocals with meaningful lyrics and strong song structure.'}",
        "",
        "Generate something musically compelling, unique, and ACE-Step optimized now:"
    ]
    
    # Add custom theme if provided
    if custom_theme:
        prompt_parts.extend([
            "",
            f"**Special Theme Request:** Focus on or incorporate elements of: {custom_theme}"
        ])
    
    # Add seed information (always include the determined seed)
    prompt_parts.extend([
        "",
        f"**Seed Requirement:** Use seed {seed_value} for reproducible generation. Include this exact seed value in your response."
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