"""Fix double-encoded UTF-8 (mojibake) in App.jsx.

The file was double-encoded: UTF-8 bytes were decoded as Windows-1252,
then re-encoded as UTF-8. We fix by mapping each known bad sequence
to the correct Unicode character.
"""

f = "frontend/src/App.jsx"

with open(f, "r", encoding="utf-8") as fh:
    text = fh.read()

# Build replacement map from actual hex codepoints found in the file.
# Format: (bad_codepoints_as_string, correct_unicode_string)
replacements = [
    # Box drawing horizontal ─ (U+2500): shows as â"€ 
    # Hex: 00e2 201d 20ac -> should be just one char
    ("\u00e2\u201d\u20ac", "\u2500"),
    
    # Em dash — (U+2014): â€"
    ("\u00e2\u20ac\u201c", "\u2014"),
    
    # Right arrow → : â†'
    ("\u00e2\u2020\u2019", "\u2192"),
    
    # Left arrow ← : â†←
    ("\u00e2\u2020\u0090", "\u2190"),
    
    # Check mark ✅: â✅
    ("\u00e2\u0153\u2026", "\u2705"),
    
    # Warning ⚠️: âš + 00a0 + ï¸ (ef b8 8f)
    ("\u00e2\u0161\u00a0\u00ef\u00b8\u008f", "\u26a0\ufe0f"),
    
    # Warning ⚠ without variant selector
    ("\u00e2\u0161\u00a0", "\u26a0"),

    # Lightning ⚡: âš¡ 
    ("\u00e2\u0161\u00a1", "\u26a1"),
    
    # Pause ⏸️: â⏸ï¸
    ("\u00e2\u008f\u00b8\u00ef\u00b8\u008f", "\u23f8\ufe0f"),
    
    # Play ▶️: â–¶ï (partial)
    ("\u00e2\u2013\u00b6\u00ef\u00b8\u008f", "\u25b6\ufe0f"),
    
    # Trophy 🏆: ðŸ†  -> F0 9F 8F 86
    ("\u00f0\u0178\u008f\u2020", "\U0001f3c6"),
    
    # Skull 💀: ðŸ'€
    ("\u00f0\u0178\u2019\u20ac", "\U0001f480"),
    
    # Clipboard 📋: ðŸ"‹
    ("\u00f0\u0178\u201c\u2039", "\U0001f4cb"),
    
    # Handshake 🤝: ðŸ¤
    ("\u00f0\u0178\u00a4", "\U0001f91d"),
    
    # Boom 💥: ðŸ'¥
    ("\u00f0\u0178\u2019\u00a5", "\U0001f4a5"),
    
    # No entry 🚫: ðŸš«
    ("\u00f0\u0178\u0161\u00ab", "\U0001f6ab"),
    
    # Outbox 📤: ðŸ"¤
    ("\u00f0\u0178\u201c\u00a4", "\U0001f4e4"),
    
    # Graduation cap 🎓: ðŸŽ"
    ("\u00f0\u0178\u017d\u201c", "\U0001f393"),
    
    # Globe 🌍: ðŸŒ
    ("\u00f0\u0178\u0152", "\U0001f30d"),
    
    # Pound sign £: Â£
    ("\u00c2\u00a3", "\u00a3"),
    
    # Middle dot ·: Â·
    ("\u00c2\u00b7", "\u00b7"),
    
    # Section sign §: Â§
    ("\u00c2\u00a7", "\u00a7"),
]

count = 0
for bad, good in replacements:
    if bad in text:
        n = text.count(bad)
        text = text.replace(bad, good)
        count += n
        print(f"  Fixed {n}x: -> {good} ({repr(good)})")

print(f"\nTotal replacements: {count}")

# Verify no remaining mojibake lead bytes
remaining_f0 = text.count("\u00f0")
remaining_c2 = sum(1 for i, c in enumerate(text) if c == "\u00c2" and i+1 < len(text) and ord(text[i+1]) > 0x7f)
remaining_e2 = sum(1 for i, c in enumerate(text) if c == "\u00e2" and i+1 < len(text) and ord(text[i+1]) > 0x7f and text[i+1] not in "\u0161\u0153")
print(f"Remaining \\u00f0: {remaining_f0}")
print(f"Remaining \\u00c2+hi: {remaining_c2}")

with open(f, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(text)
print("Saved.")
