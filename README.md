# Laya decision brain

Next.js + FastAPI lab for [Laya](https://github.com/convaiinnovations/laya). Ask the model about a steak-and-risk survey, inspect one decision, and watch it play Snake.

- Frontend: http://localhost:3001
- Backend: http://localhost:8000 (`/docs`)

## Run

```bash
npm install
npm --prefix frontend install
cd backend && uv sync
cd ..
npm run dev
```

## Survey

http://localhost:3001 — FiveThirtyEight steak & risk survey (550 respondents).

- **This person** — pick a respondent and ask Laya yes/no or A-or-B questions
- **Whole survey** — real crosstabs plus Laya’s read of the CSV, then a 48-person crowd check
- **See the math** — logits, temperature, attribution for the person on the left

## Snake

http://localhost:3001/snake — Laya picks each heading via `POST /evaluate`. Hunt labels mark EAT / HUNT / TRAP / DEATH. A seatbelt refuses walls, reverses, and pockets; career lessons from each death are fed into the next game. Arrow keys / WASD take over.
