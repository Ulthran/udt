from bs4 import BeautifulSoup
import json

with open("glossary.html", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f, "html.parser")

glossary = {}
current_term = None
collecting = False
definition_parts = []

for tag in soup.find_all(["p", "div"]):
    if tag.name == "p":
        strong = tag.find("strong")
        em = tag.find("em")

        if strong and ":" in strong.text:
            # Save previous term
            if current_term:
                glossary[current_term] = " ".join(definition_parts).strip()
            # Start new term
            current_term = strong.get_text(strip=True).rstrip(":")
            definition_text = tag.get_text(strip=True).replace(strong.get_text(strip=True), "").strip(": ").strip()
            definition_parts = [definition_text]
            collecting = True
        elif collecting and not em:
            # Continuation of current term
            definition_parts.append(tag.get_text(strip=True))
    elif tag.name == "div":
        # Reset on horizontal rule
        if collecting and current_term:
            glossary[current_term] = " ".join(definition_parts).strip()
            current_term = None
            definition_parts = []
            collecting = False

# Final entry
if current_term:
    glossary[current_term] = " ".join(definition_parts).strip()

# Save to JSON
with open("glossary.json", "w", encoding="utf-8") as f:
    json.dump(glossary, f, indent=2, ensure_ascii=False)

print("Glossary successfully saved to glossary.json")
