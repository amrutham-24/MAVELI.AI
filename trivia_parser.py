import os
import random

def parse_questions(filepath="questions.md"):
    questions = []
    
    if not os.path.exists(filepath):
        return questions
        
    with open(filepath, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
        
    current_q = None
    
    for line in lines:
        if line.startswith("A) ") or line.startswith("B) ") or line.startswith("C) ") or line.startswith("D) "):
            if current_q:
                is_correct = "✅" in line
                opt_text = line[3:].replace("✅", "").strip()
                current_q["options"].append(opt_text)
                if is_correct:
                    current_q["correct_index"] = len(current_q["options"]) - 1
        elif not line.startswith("🌼") and not line.startswith("👑") and not line.startswith("🍃") and not line.startswith("🛶") and not line.startswith("🌸") and not line.startswith("🎉"):
            if current_q and len(current_q["options"]) > 0:
                questions.append(current_q)
            current_q = {
                "question": line,
                "options": [],
                "correct_index": 0
            }
            
    if current_q and len(current_q["options"]) > 0:
        questions.append(current_q)
        
    return questions

def get_random_question(questions):
    if not questions:
        return None
    return random.choice(questions)
