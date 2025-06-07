#!/usr/bin/env python3
"""
Generate AI prompt for instrumental music generation optimized for ACE-Step
"""
import sys
import os
import random
from datetime import datetime

def generate_prompt(custom_theme=None, custom_seed=None):
    """Generate the instrumental music generation prompt"""
    current_time = datetime.now().strftime("%H:%M")
    current_date = datetime.now().strftime("%A, %B %d, %Y")
    
    # Generate seed for reproducible results
    if custom_seed:
        try:
            seed_value = int(custom_seed)
        except:
            seed_value = random.randint(1, 4294967295)
    else:
        seed_value = random.randint(1, 4294967295)
    
    prompt_parts = [
        "You are an AI music production specialist with deep expertise in ACE-Step. Generate creative INSTRUMENTAL music parameters optimized for ACE-Step's capabilities.",
        "",
        "**Current Context:**",
        f"- Current time: {current_time}",
        f"- Current date: {current_date}",
        "- Target system: ACE-Step AI music generation",
        "- Mode: INSTRUMENTAL ONLY",
        "",
        "**1. Style Prompt:** Create EXACTLY 3-5 comma-separated, lowercase tags focusing on UPLIFTING genres only.",
        "**REQUIRED MOOD CATEGORIES (choose tags from these categories only):**",
        "- **Exercise/Energy:** electronic, energetic, upbeat, driving, rhythmic, motivational, pump, cardio, workout",
        "- **Calm/Relaxation:** ambient, peaceful, tranquil, meditative, soothing, gentle, serene, soft, chill",
        "- **Focus/Productivity:** minimal, focused, atmospheric, steady, flowing, concentrated, clear, balanced",
        "- **Uplifting/Positive:** uplifting, bright, optimistic, warm, inspiring, hopeful, joyful, light, positive",
        "",
        "**INSTRUMENT TAGS (optional, max 1-2):** piano, guitar, synthesizer, strings, nature sounds, bells, flute",
        "",
        "**FORBIDDEN MOODS/GENRES:** Never use tags like: dark, sad, melancholy, depressing, aggressive, angry, heavy, intense, dramatic, noir, gothic, doom, or any negative emotional descriptors.",
        "",
        "**2. Lyrics:** ALWAYS use exactly [inst] - this is an instrumental track only",
        "- No vocal content whatsoever",
        "- Focus purely on instrumental arrangement and melody",
        "",
        "**3. Duration:** Choose from 60, 90, 120, 150, or 180 seconds (optimal for exercise/relaxation sessions).",
        "",
        "**4. Title:** Generate UNIQUE, POSITIVE titles that reflect the uplifting nature.",
        "- Use inspiring, peaceful, or energetic themes",
        "- Examples: 'Morning Sunrise Flow', 'Peaceful Garden Walk', 'Energy Boost', 'Calm Waters', 'Focused Mind'",
        "- Avoid: any dark, sad, or negative terms",
        "",
        "**5. Inspiration:** Brief explanation focusing on wellness, exercise, relaxation, or productivity benefits.",
        "",
        "**Output Format (JSON only):**",
        "{",
        '  "style_prompt": "3-5 comma-separated uplifting tags only",',
        '  "lyrics": "[inst]",',
        '  "duration": number (60-180),',
        '  "title_suggestion": "positive, uplifting title",',
        '  "inspiration": "wellness/exercise/relaxation focused explanation",',
        f'  "seed": {seed_value}',
        "}",
        "",
        "**Quality Standards:** All content must be uplifting, positive, and suitable for wellness activities.",
        "**ACE-Step Optimization:** Focus on clear melodies and arrangements that work well instrumentally.",
        "**Wellness Focus:** Consider how this music will be used for exercise, meditation, or productivity.",
        "",
        f"**Seed: {seed_value}**",
        "Generate uplifting instrumental music parameters now:"
    ]
    
    # Add custom theme if provided (but still keep it positive)
    if custom_theme:
        prompt_parts.extend([
            "",
            f"**Special Theme Request:** Incorporate positive elements of: {custom_theme} (maintain uplifting mood)"
        ])
    
    # Add seed information
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
    
    print("✅ Instrumental music generation prompt created successfully")

if __name__ == "__main__":
    main() 